#!/usr/bin/env node
/**
 * MailTidy CLI 入口。
 *
 * 当前阶段（Phase V2）：
 *   - SQLite 作为权威数据层
 *   - RAG 语义记忆系统
 *   - 可审计、可回滚的学习系统
 */

import { Command } from "commander";
import path from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai";
import { JsonMemoryStore, getRecentHistory, rollbackToHistoryEntry, getHistoryBySender, loadAgentMemoryFromSQLite } from "../data/memory.js";
import { ReportStore } from "../data/reports.js";
import { JsonTaskStore, type TaskRecord } from "../data/tasks.js";
import { CheckpointStore, parseRecoveryChoice, formatRecoveryPrompt } from "../agent/recovery.js";
import { TraceStore } from "../agent/trace.js";
import { LegacyMailTidyAgent } from "../agent/legacy.js";
import { runAgentLoop, type RunAgentLoopOptions } from "../agent/loop.js";
import { continueRecoveredTask } from "../agent/recoveryContinue.js";
import { MockEmailConnector } from "../integrations/email/mock.js";
import { AnthropicLLMClient } from "../integrations/llm/anthropic.js";
import { FallbackLLMClient } from "../integrations/llm/fallback.js";
import { HeuristicLLMClient } from "../integrations/llm/heuristic.js";
import { OpenAILLMClient } from "../integrations/llm/openai.js";
import { ZhipuLLMClient } from "../integrations/llm/zhipu.js";
import type { LLMClient } from "../llm/client.js";
import { LLMRouter } from "../llm/router.js";
import { loadMailTidyConfig, resolveLLMConfig, type LLMProviderName } from "../ops/config.js";
import { createMailTidyTools } from "../tools/registry.js";
import { createReadlinePrompter, type Prompter } from "./prompts.js";
import { createDatabase, getDefaultDatabasePath } from "../data/database.js";
import { PreferenceRepository } from "../data/preferences.js";
import { migrateFromJson, checkMigrationNeeded } from "../data/migration.js";
import { MemoryItemGenerator } from "../data/memory-items-generator.js";
import { HeuristicEmbeddingProvider } from "../integrations/embedding/heuristic.js";
import { SimpleMemoryIndex } from "../data/vector-index.js";

interface RuntimePaths {
  root: string;
  memory: string;
  tasksDir: string;
  checkpointsDir: string;
  reportsDir: string;
  tracesDir: string;
  config: string;
}

function resolvePaths(rootArg: string): RuntimePaths {
  const root = path.resolve(rootArg);
  return {
    root,
    memory: path.join(root, "memory.json"),
    tasksDir: path.join(root, "tasks"),
    checkpointsDir: path.join(root, "checkpoints"),
    reportsDir: path.join(root, "reports"),
    tracesDir: path.join(root, "traces"),
    config: path.join(root, "config.json"),
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
        tools: createMailTidyTools({ connector, llm, memory, stateDir: paths.root }),
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
    .option("--automation-mode <mode>", "Automation mode: conservative, balanced, or aggressive", "balanced")
    .option("--llm-provider <provider>", "LLM provider for --agent: heuristic, openai, or anthropic")
    .option("--llm-model <model>", "Provider model id for --agent")
    .option("--dimension <name>", "Custom dimension to classify (repeatable)", collect, [] as string[])
    .action(async (options) => {
      requireDemo(options);
      const paths = resolvePaths(program.opts().stateDir);
      if (options.agent) {
        const result = await runAgentCommand(paths, {
          customDimensions: options.dimension,
          autoConfirm: options.autoConfirm,
          automationMode: parseAutomationMode(options.automationMode),
          llmProvider: options.llmProvider,
          llmModel: options.llmModel,
        });
        console.log(result.report);
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
    .option("--automation-mode <mode>", "Automation mode: conservative, balanced, or aggressive", "balanced")
    .option("--llm-provider <provider>", "LLM provider for --agent: heuristic, openai, or anthropic")
    .option("--llm-model <model>", "Provider model id for --agent")
    .option("--dimension <name>", "Custom dimension (repeatable)", collect, [] as string[])
    .action(async (options) => {
      requireDemo(options);
      const paths = resolvePaths(program.opts().stateDir);
      if (options.agent) {
        const result = await runAgentCommand(paths, {
          sop: "daily_brief",
          customDimensions: options.dimension,
          automationMode: parseAutomationMode(options.automationMode),
          llmProvider: options.llmProvider,
          llmModel: options.llmModel,
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
    .option("--llm-provider <provider>", "LLM provider for --agent: heuristic, openai, or anthropic")
    .option("--llm-model <model>", "Provider model id for --agent")
    .action(async (options) => {
      requireDemo(options);
      const paths = resolvePaths(program.opts().stateDir);
      if (options.agent) {
        const result = await runAgentCommand(paths, {
          sop: "subscription_scan",
          llmProvider: options.llmProvider,
          llmModel: options.llmModel,
        });
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
    .option("--llm-provider <provider>", "LLM provider for --agent: heuristic, openai, or anthropic")
    .option("--llm-model <model>", "Provider model id for --agent")
    .action(async (options) => {
      requireDemo(options);
      const paths = resolvePaths(program.opts().stateDir);
      if (options.agent) {
        const result = await runAgentCommand(paths, {
          sop: "draft_replies",
          autoConfirm: options.autoConfirm,
          dryRun: options.dryRun,
          llmProvider: options.llmProvider,
          llmModel: options.llmModel,
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

  const memoryCommand = program
    .command("memory")
    .description("Manage agent memory and preferences");

  memoryCommand
    .command("list")
    .description("List all sender preferences")
    .action(async () => {
      const paths = resolvePaths(program.opts().stateDir);
      const memoryStore = new JsonMemoryStore(paths.memory);
      const memory = await memoryStore.load();

      if (Object.keys(memory.senderPreferences).length === 0) {
        console.log("No sender preferences stored.");
        return;
      }

      console.log("Sender Preferences:");
      console.log("=".repeat(80));
      for (const [sender, pref] of Object.entries(memory.senderPreferences)) {
        console.log(`\n${sender}`);
        console.log(`  Category: ${pref.category ?? "None"}`);
        console.log(`  Preferred Action: ${pref.preferredAction ?? "None"}`);
        console.log(`  Importance Delta: ${pref.importanceDelta}`);
        console.log(`  Ignored Count: ${pref.ignoredCount}`);
        if (pref.learnedFrom) {
          console.log(`  Learned From: ${pref.learnedFrom}`);
        }
        if (pref.learnedAt) {
          console.log(`  Learned At: ${new Date(pref.learnedAt).toLocaleString()}`);
        }
      }
    });

  memoryCommand
    .command("history")
    .description("View preference change history")
    .option("--sender <email>", "Filter by sender email")
    .option("--limit <number>", "Limit number of entries", "20")
    .action(async (options) => {
      const paths = resolvePaths(program.opts().stateDir);
      const memoryStore = new JsonMemoryStore(paths.memory);
      const memory = await memoryStore.load();

      const history = options.sender
        ? getHistoryBySender(memory, options.sender)
        : getRecentHistory(memory, parseInt(options.limit));

      if (history.length === 0) {
        console.log("No history entries found.");
        return;
      }

      console.log("Preference History:");
      console.log("=".repeat(80));
      for (const entry of history) {
        const time = new Date(entry.timestamp).toLocaleString();
        console.log(`\nID: ${entry.id}`);
        console.log(`  Time: ${time}`);
        console.log(`  Sender: ${entry.sender}`);
        console.log(`  Action: ${entry.actionType}`);
        if (entry.reason) {
          console.log(`  Reason: ${entry.reason}`);
        }
        console.log(`  New Action: ${entry.newPreference.preferredAction ?? "None"}`);
        if (entry.previousPreference) {
          console.log(`  Previous Action: ${entry.previousPreference.preferredAction ?? "None"}`);
        }
      }
    });

  memoryCommand
    .command("rollback")
    .description("Rollback to a previous preference state")
    .argument("<id>", "History entry ID to rollback to")
    .action(async (historyId) => {
      const paths = resolvePaths(program.opts().stateDir);
      const memoryStore = new JsonMemoryStore(paths.memory);
      const memory = await memoryStore.load();

      const result = rollbackToHistoryEntry(memory, historyId);

      if (result.success) {
        await memoryStore.save(memory);
        console.log(result.message);
      } else {
        console.error(`Error: ${result.message}`);
        process.exit(1);
      }
    });

  memoryCommand
    .command("show")
    .description("Show details for a specific sender")
    .argument("<sender>", "Sender email address")
    .action(async (sender) => {
      const paths = resolvePaths(program.opts().stateDir);
      const memoryStore = new JsonMemoryStore(paths.memory);
      const memory = await memoryStore.load();

      const pref = memory.senderPreferences[sender.toLowerCase()];

      if (!pref) {
        console.log(`No preference found for ${sender}`);
        return;
      }

      console.log(`Preferences for ${sender}:`);
      console.log("=".repeat(80));
      console.log(`Category: ${pref.category ?? "None"}`);
      console.log(`Preferred Action: ${pref.preferredAction ?? "None"}`);
      console.log(`Importance Delta: ${pref.importanceDelta}`);
      console.log(`Ignored Count: ${pref.ignoredCount}`);
      if (pref.learnedFrom) {
        console.log(`Learned From: ${pref.learnedFrom}`);
      }
      if (pref.learnedAt) {
        console.log(`Learned At: ${new Date(pref.learnedAt).toLocaleString()}`);
      }

      const history = getHistoryBySender(memory, sender);
      if (history.length > 0) {
        console.log(`\nRecent History (${history.length} entries):`);
        for (const entry of history.slice(0, 5)) {
          const time = new Date(entry.timestamp).toLocaleString();
          console.log(`  ${time}: ${entry.actionType} - ${entry.reason ?? "no reason"}`);
        }
      }
    });

  const dbCommand = program
    .command("db")
    .description("Manage the SQLite database");

  dbCommand
    .command("migrate")
    .description("Run database migrations")
    .action(async () => {
      const paths = resolvePaths(program.opts().stateDir);
      const dbPath = getDefaultDatabasePath(paths.root);
      const db = await createDatabase(dbPath);
      console.log(`Database migrated to version ${await db.getCurrentVersion()}`);
      await db.close();
    });

  dbCommand
    .command("status")
    .description("Check database status and version")
    .action(async () => {
      const paths = resolvePaths(program.opts().stateDir);
      const dbPath = getDefaultDatabasePath(paths.root);
      const db = await createDatabase(dbPath);
      const version = await db.getCurrentVersion();
      const prefCount = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM preferences");
      const logCount = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM decision_logs");
      const memoryItemCount = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM memory_items");
      
      console.log(`Database Version: ${version}`);
      console.log(`Preferences: ${prefCount?.count ?? 0}`);
      console.log(`Decision Logs: ${logCount?.count ?? 0}`);
      console.log(`Memory Items: ${memoryItemCount?.count ?? 0}`);
      
      await db.close();
    });

  dbCommand
    .command("migrate-from-json")
    .description("Migrate data from memory.json to SQLite")
    .action(async () => {
      const paths = resolvePaths(program.opts().stateDir);
      const dbPath = getDefaultDatabasePath(paths.root);
      const db = await createDatabase(dbPath);
      
      const result = await migrateFromJson(db, paths.memory);
      
      console.log("Migration Results:");
      console.log(`  Preferences migrated: ${result.migratedPreferences}`);
      console.log(`  Action Preferences migrated: ${result.migratedActionPreferences}`);
      console.log(`  Style Profile migrated: ${result.migratedStyleProfile}`);
      console.log(`  Subscriptions migrated: ${result.migratedSubscriptions}`);
      console.log(`  History entries migrated: ${result.migratedHistory}`);
      
      if (result.errors.length > 0) {
        console.log("\nErrors:");
        for (const error of result.errors) {
          console.log(`  - ${error}`);
        }
      }
      
      await db.close();
    });

  memoryCommand
    .command("rebuild-index")
    .description("Rebuild the semantic memory index from memory items")
    .action(async () => {
      const paths = resolvePaths(program.opts().stateDir);
      const dbPath = getDefaultDatabasePath(paths.root);
      const db = await createDatabase(dbPath);
      
      const generator = new MemoryItemGenerator({ db });
      const result = await generator.rebuildAll();
      
      console.log(`Generated ${result.generated} memory items`);
      
      if (result.errors.length > 0) {
        console.log("\nErrors:");
        for (const error of result.errors) {
          console.log(`  - ${error}`);
        }
      }
      
      const embeddingProvider = new HeuristicEmbeddingProvider();
      const memoryIndex = new SimpleMemoryIndex(db, embeddingProvider);
      await memoryIndex.rebuild();
      
      console.log("\nSemantic memory index rebuilt");
      await db.close();
    });

  memoryCommand
    .command("forget")
    .description("Forget a sender's preferences")
    .argument("<sender>", "Sender email address to forget")
    .action(async (sender) => {
      const paths = resolvePaths(program.opts().stateDir);
      const dbPath = getDefaultDatabasePath(paths.root);
      const db = await createDatabase(dbPath);
      
      const preferenceRepo = new PreferenceRepository(db);
      const pref = await preferenceRepo.getByScopeAndKey("sender", sender.toLowerCase());
      
      if (!pref) {
        console.log(`No preference found for ${sender}`);
        await db.close();
        return;
      }
      
      await preferenceRepo.archivePreference(pref.id, `User requested to forget ${sender}`);
      
      const embeddingProvider = new HeuristicEmbeddingProvider();
      const memoryIndex = new SimpleMemoryIndex(db, embeddingProvider);
      await memoryIndex.tombstoneByScope("sender", sender.toLowerCase());
      
      console.log(`Forgotten preferences for ${sender}`);
      await db.close();
    });

  memoryCommand
    .command("search")
    .description("Search memory semantically")
    .argument("<query>", "Search query")
    .option("--limit <number>", "Maximum results", "8")
    .option("--min-score <number>", "Minimum similarity score", "0.72")
    .action(async (query, options) => {
      const paths = resolvePaths(program.opts().stateDir);
      const dbPath = getDefaultDatabasePath(paths.root);
      const db = await createDatabase(dbPath);
      
      const embeddingProvider = new HeuristicEmbeddingProvider();
      const memoryIndex = new SimpleMemoryIndex(db, embeddingProvider);
      
      const results = await memoryIndex.search({
        query,
        limit: parseInt(options.limit),
        minScore: parseFloat(options.minScore),
      });
      
      console.log(`Found ${results.length} results:`);
      console.log("=".repeat(80));
      
      for (const result of results) {
        console.log(`\nScore: ${(result.score * 100).toFixed(1)}%`);
        console.log(`Type: ${result.type}`);
        if (result.title) console.log(`Title: ${result.title}`);
        console.log(`Summary: ${result.summary}`);
        if (result.sourceId) console.log(`Source ID: ${result.sourceId}`);
      }
      
      await db.close();
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

function parseAutomationMode(value: string): "conservative" | "balanced" | "aggressive" {
  if (value === "conservative" || value === "balanced" || value === "aggressive") return value;
  throw new Error(`Invalid --automation-mode "${value}". Expected conservative, balanced, or aggressive.`);
}

type AgentCommandOptions = RunAgentLoopOptions & {
  llmProvider?: string;
  llmModel?: string;
};

async function runAgentCommand(
  paths: RuntimePaths,
  options: AgentCommandOptions,
): Promise<Awaited<ReturnType<typeof runAgentLoop>>> {
  const memoryStore = new JsonMemoryStore(paths.memory);
  const memory = await memoryStore.load();
  const config = await loadMailTidyConfig(paths.config);
  const llmConfig = resolveLLMConfig(config, {
    llmProvider: options.llmProvider,
    llmModel: options.llmModel,
  });
  const llm = buildLLMClient(llmConfig.provider, llmConfig.model);
  const { llmProvider: _llmProvider, llmModel: _llmModel, ...loopOptions } = options;
  const result = await runAgentLoop(
    {
      connector: new MockEmailConnector(),
      router: new LLMRouter({ primary: llm, heuristic: new HeuristicLLMClient() }, {}, "primary"),
      tasks: new JsonTaskStore(paths.tasksDir),
      checkpoints: new CheckpointStore(paths.checkpointsDir),
      memory,
      reports: new ReportStore(paths.reportsDir),
      traces: new TraceStore(paths.tracesDir),
      stateDir: paths.root,
    },
    loopOptions,
  );
  await memoryStore.save(memory);
  return result;
}

function buildLLMClient(provider: LLMProviderName, modelId?: string): LLMClient {
  const heuristic = new HeuristicLLMClient();
  if (provider === "heuristic") return heuristic;
  
  let primary: LLMClient;
  if (provider === "openai") {
    primary = new OpenAILLMClient({ modelId });
  } else if (provider === "anthropic") {
    primary = new AnthropicLLMClient({ modelId });
  } else if (provider === "zhipu") {
    primary = new ZhipuLLMClient({ model: modelId });
  } else {
    primary = heuristic;
  }
  
  return new FallbackLLMClient({
    primary,
    fallback: heuristic,
    onFallback: ({ method, error, primary: primaryProfile, fallback }) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `LLM fallback: ${primaryProfile.provider}/${primaryProfile.name} failed during ${method}; using ${fallback.provider}/${fallback.name}. Reason: ${message}`,
      );
    },
  });
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
