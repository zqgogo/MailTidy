#!/usr/bin/env node
/**
 * MailTidy CLI 入口。
 *
 * 当前阶段（Phase 0 + 恢复层骨架）：
 *   - `run-cleanup --demo` 等 4 条子命令走 LegacyMailTidyAgent（流水线 SOP）。
 *   - 启动时跑 `scanInterrupted()`：把上次未收尾的任务列出来，让用户选
 *     [r] 重跑 / [c] 续跑 / [s] 跳过 / [d] 删除记录。
 *     —— 当前"续跑"是占位（Phase 1 主循环上来后真正接 agentLoopContinue）。
 *   - SIGINT 收到后调 abortCurrentTask()：把当前任务标记为 interrupted，
 *     写盘 checkpoint 后再退出。
 *
 * 不强制 --demo 是为了让 SIGINT / 恢复扫描的开关单独可测；但实际 SOP 调用
 * 仍要求 --demo，避免误以为在动真邮箱。
 */

import { Command } from "commander";
import path from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai";
import { JsonMemoryStore } from "../data/memory.js";
import { JsonTaskStore, type TaskRecord } from "../data/tasks.js";
import { CheckpointStore, parseRecoveryChoice, formatRecoveryPrompt } from "../agent/recovery.js";
import { LegacyMailTidyAgent } from "../agent/legacy.js";
import { runAgentLoop } from "../agent/loop.js";
import { continueRecoveredTask } from "../agent/recoveryContinue.js";
import { MockEmailConnector } from "../integrations/email/mock.js";
import { HeuristicLLMClient } from "../integrations/llm/heuristic.js";
import { LLMRouter } from "../llm/router.js";
import { createMailTidyTools } from "../tools/registry.js";
import { createReadlinePrompter, type Prompter } from "./prompts.js";

interface RuntimePaths {
  root: string;
  memory: string;
  tasksDir: string;
  checkpointsDir: string;
}

function resolvePaths(rootArg: string): RuntimePaths {
  const root = path.resolve(rootArg);
  return {
    root,
    memory: path.join(root, "memory.json"),
    tasksDir: path.join(root, "tasks"),
    checkpointsDir: path.join(root, "checkpoints"),
  };
}

async function runRecoveryScan(paths: RuntimePaths, prompter: Prompter, options: { demo?: boolean } = {}): Promise<void> {
  const tasks = new JsonTaskStore(paths.tasksDir);
  const checkpoints = new CheckpointStore(paths.checkpointsDir);
  const pending = await tasks.scanInterrupted();
  if (pending.length === 0) return;

  console.error(`\nFound ${pending.length} unfinished task(s) from a previous run:\n`);
  for (const task of pending) {
    const checkpoint = await checkpoints.load(task.taskId);
    console.error(formatRecoveryPrompt({ task, checkpoint }));
    const answer = await prompter.ask("> ");
    const choice = parseRecoveryChoice(answer);
    switch (choice) {
      case "rerun":
        console.error(`(rerun not implemented yet — keeping record ${task.taskId.slice(0, 8)})`);
        break;
      case "continue":
        if (!options.demo) {
          console.error(
            `(continue needs a real pi model adapter; rerun with recover --demo for the current faux-provider path)`,
          );
          break;
        }
        if (!checkpoint) {
          console.error(`(no checkpoint found — cannot continue ${task.taskId.slice(0, 8)})`);
          break;
        }
        await continueDemoTask(paths, task, checkpoint);
        break;
      case "drop":
        await tasks.purge(task.taskId);
        await checkpoints.purge(task.taskId);
        console.error(`Dropped task record ${task.taskId.slice(0, 8)}.`);
        break;
      default:
        console.error(`Skipped task ${task.taskId.slice(0, 8)}.`);
    }
    console.error("");
  }
}

async function continueDemoTask(
  paths: RuntimePaths,
  task: TaskRecord,
  checkpoint: NonNullable<Awaited<ReturnType<CheckpointStore["load"]>>>,
): Promise<void> {
  const faux = registerFauxProvider();
  faux.setResponses([fauxAssistantMessage(`Resumed demo task ${task.taskId.slice(0, 8)}.`)]);
  try {
    const memoryStore = new JsonMemoryStore(paths.memory);
    const memory = await memoryStore.load();
    const connector = new MockEmailConnector();
    const llm = new HeuristicLLMClient();
    const result = await continueRecoveredTask(
      {
        tasks: new JsonTaskStore(paths.tasksDir),
        checkpoints: new CheckpointStore(paths.checkpointsDir),
        tools: createMailTidyTools({ connector, llm, memory }),
        model: faux.getModel(),
      },
      task,
      checkpoint,
    );
    console.error(`Continued task ${task.taskId.slice(0, 8)}: ${result.exit.reason}`);
    if (result.finalText) console.log(result.finalText);
  } finally {
    faux.unregister();
  }
}

/**
 * SIGINT 框架：注册 once；触发时把"当前任务"句柄翻成 interrupted 后退出。
 * Phase 1 主循环挂上来后，handler 内部还会调 `agent.abort()` 取消 in-flight tool call。
 */
function installSigintHandler(getCurrentTask: () => TaskRecord | null, deps: { tasks: JsonTaskStore; checkpoints: CheckpointStore }): void {
  let firing = false;
  process.on("SIGINT", () => {
    if (firing) return;
    firing = true;
    void (async () => {
      const current = getCurrentTask();
      if (current) {
        try {
          await deps.tasks.markInterrupted(current, "sigint");
        } catch (err) {
          console.error(`Failed to persist interrupt for ${current.taskId}:`, err);
        }
      }
      console.error("\nReceived SIGINT — task state saved; exit.");
      process.exit(130);
    })();
  });
}

async function buildLegacyAgent(paths: RuntimePaths): Promise<{ agent: LegacyMailTidyAgent; memoryStore: JsonMemoryStore }> {
  const memoryStore = new JsonMemoryStore(paths.memory);
  const memory = await memoryStore.load();
  const agent = new LegacyMailTidyAgent({
    connector: new MockEmailConnector(),
    llm: new HeuristicLLMClient(),
    memory,
  });
  return { agent, memoryStore };
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("mailtidy")
    .description("MailTidy email agent — TypeScript edition built on @earendil-works/pi-agent-core")
    .option("--state-dir <path>", "Directory to store local memory / tasks / checkpoints", ".mailtidy");

  program
    .command("recover")
    .description("Scan for unfinished tasks from prior runs and prompt for action")
    .option("--demo", "Continue using mock email connector + faux pi provider", false)
    .action(async (options) => {
      const paths = resolvePaths(program.opts().stateDir);
      const prompter = createReadlinePrompter();
      try {
        await runRecoveryScan(paths, prompter, options);
      } finally {
        await prompter.close();
      }
    });

  program
    .command("run-cleanup")
    .description("Run inbox cleanup SOP")
    .option("--demo", "Use mock email connector + heuristic LLM", false)
    .option("--agent", "Use the Phase 1 runAgentLoop entry-point instead of legacy pipeline", false)
    .option("--auto-confirm", "Approve confirmation-gated actions", false)
    .option("--dimension <name>", "Custom dimension to classify (repeatable)", collect, [] as string[])
    .action(async (options) => {
      requireDemo(options);
      const paths = resolvePaths(program.opts().stateDir);
      if (options.agent) {
        const memoryStore = new JsonMemoryStore(paths.memory);
        const memory = await memoryStore.load();
        const llm = new HeuristicLLMClient();
        const result = await runAgentLoop(
          {
            connector: new MockEmailConnector(),
            router: new LLMRouter({ heuristic: llm }),
            tasks: new JsonTaskStore(paths.tasksDir),
            checkpoints: new CheckpointStore(paths.checkpointsDir),
            memory,
          },
          {
            customDimensions: options.dimension,
            autoConfirm: options.autoConfirm,
          },
        );
        console.log(result.report);
        await memoryStore.save(memory);
        return;
      }
      await withTaskLifecycle(paths, { sop: "inbox_cleanup", invocation: options }, async (_record) => {
        const { agent, memoryStore } = await buildLegacyAgent(paths);
        const report = await agent.runCleanup({
          customDimensions: options.dimension,
          autoConfirm: options.autoConfirm,
        });
        console.log(report);
        await memoryStore.save(agent.memory);
      });
    });

  program
    .command("daily-brief")
    .description("Generate daily briefing")
    .option("--demo", "Use mock email connector + heuristic LLM", false)
    .option("--agent", "Use the Phase 1 runAgentLoop entry-point instead of legacy pipeline", false)
    .option("--dimension <name>", "Custom dimension (repeatable)", collect, [] as string[])
    .action(async (options) => {
      requireDemo(options);
      const paths = resolvePaths(program.opts().stateDir);
      if (options.agent) {
        const result = await runAgentCommand(paths, {
          sop: "daily_brief",
          customDimensions: options.dimension,
        });
        console.log(result.report);
        return;
      }
      await withTaskLifecycle(paths, { sop: "daily_brief", invocation: options }, async () => {
        const { agent, memoryStore } = await buildLegacyAgent(paths);
        const brief = await agent.dailyBriefing(options.dimension);
        console.log(brief);
        await memoryStore.save(agent.memory);
      });
    });

  program
    .command("subscription-scan")
    .description("Scan for likely subscriptions")
    .option("--demo", "Use mock email connector + heuristic LLM", false)
    .option("--agent", "Use the Phase 1 runAgentLoop entry-point instead of legacy pipeline", false)
    .action(async (options) => {
      requireDemo(options);
      const paths = resolvePaths(program.opts().stateDir);
      if (options.agent) {
        const result = await runAgentCommand(paths, { sop: "subscription_scan" });
        console.log(result.report);
        return;
      }
      await withTaskLifecycle(paths, { sop: "subscription_scan", invocation: options }, async () => {
        const { agent, memoryStore } = await buildLegacyAgent(paths);
        const { markdown, csv } = await agent.scanSubscriptions();
        console.log(markdown);
        console.log("\nCSV\n");
        console.log(csv);
        await memoryStore.save(agent.memory);
      });
    });

  program
    .command("draft-replies")
    .description("Draft replies for actionable messages")
    .option("--demo", "Use mock email connector + heuristic LLM", false)
    .option("--agent", "Use the Phase 1 runAgentLoop entry-point instead of legacy pipeline", false)
    .option("--auto-confirm", "Save proposed drafts instead of previewing only", false)
    .option("--dry-run", "Preview draft creation without writing drafts", false)
    .action(async (options) => {
      requireDemo(options);
      const paths = resolvePaths(program.opts().stateDir);
      if (options.agent) {
        const result = await runAgentCommand(paths, {
          sop: "draft_replies",
          autoConfirm: options.autoConfirm,
          dryRun: options.dryRun,
        });
        console.log(result.report);
        return;
      }
      await withTaskLifecycle(paths, { sop: "draft_replies", invocation: options }, async () => {
        const { agent, memoryStore } = await buildLegacyAgent(paths);
        const result = await agent.draftReplies();
        console.log(`Created ${result.draftsCreated} draft(s).`);
        await memoryStore.save(agent.memory);
      });
    });

  await program.parseAsync(process.argv);
}

function requireDemo(opts: { demo?: boolean }): void {
  if (!opts.demo) {
    console.error("Only --demo is implemented. Real EmailConnector lands in Phase 4.");
    process.exit(2);
  }
}

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

async function runAgentCommand(
  paths: RuntimePaths,
  options: Parameters<typeof runAgentLoop>[1],
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  const memoryStore = new JsonMemoryStore(paths.memory);
  const memory = await memoryStore.load();
  const llm = new HeuristicLLMClient();
  const result = await runAgentLoop(
    {
      connector: new MockEmailConnector(),
      router: new LLMRouter({ heuristic: llm }),
      tasks: new JsonTaskStore(paths.tasksDir),
      checkpoints: new CheckpointStore(paths.checkpointsDir),
      memory,
    },
    options,
  );
  await memoryStore.save(memory);
  return result;
}

/**
 * 把 task 生命周期套在 SOP 调用上：
 *   1. create() 写盘 running 记录 → 拿到 taskId
 *   2. 注册 SIGINT handler，触发时 markInterrupted
 *   3. SOP 跑完 → markCompleted；抛异常 → markFailed
 */
async function withTaskLifecycle(
  paths: RuntimePaths,
  input: { sop: TaskRecord["sop"]; invocation: Record<string, unknown> },
  run: (record: TaskRecord) => Promise<void>,
): Promise<void> {
  const tasks = new JsonTaskStore(paths.tasksDir);
  const checkpoints = new CheckpointStore(paths.checkpointsDir);
  const record = await tasks.create({ sop: input.sop, invocation: input.invocation });
  installSigintHandler(() => record, { tasks, checkpoints });
  try {
    await run(record);
    await tasks.markCompleted(record);
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await tasks.markFailed(record, "uncaught_error", message);
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
