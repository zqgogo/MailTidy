import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CheckpointStore } from "../src/agent/recovery.js";
import { JsonTaskStore } from "../src/data/tasks.js";

let tmp: string;

beforeAll(() => {
  execFileSync("npm", ["run", "build"], { cwd: path.resolve("."), stdio: "ignore" });
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mailtidy-kill-e2e-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("kill -9 recovery e2e", () => {
  it("discovers a killed task and continues it from checkpoint", async () => {
    const killed = spawnCli(
      ["--state-dir", tmp, "run-cleanup", "--demo", "--agent", "--auto-confirm"],
      { MAILTIDY_TEST_PAUSE_AFTER_CHECKPOINT_MS: "10000" },
    );

    const tasks = new JsonTaskStore(path.join(tmp, "tasks"));
    const checkpoints = new CheckpointStore(path.join(tmp, "checkpoints"));
    const task = await waitFor(async () => {
      const pending = await tasks.scanInterrupted();
      const candidate = pending[0];
      if (!candidate) return null;
      const checkpoint = await checkpoints.load(candidate.taskId);
      return checkpoint ? candidate : null;
    });

    killProcessGroup(killed, "SIGKILL");
    await onceExit(killed);

    const afterKill = await tasks.load(task.taskId);
    expect(afterKill?.status).toBe("running");

    const recovered = spawnCli(["--state-dir", tmp, "recover", "--demo"]);
    let output = "";
    recovered.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("> ")) recovered.stdin.write("c\n");
    });
    recovered.stderr.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("> ")) recovered.stdin.write("c\n");
    });

    const code = await onceExit(recovered);
    expect(code).toBe(0);
    expect(output).toContain("Found 1 unfinished task");
    expect(output).toContain("Continued task");
    expect(output).toContain("Resumed demo task");

    const afterRecover = await tasks.load(task.taskId);
    expect(afterRecover?.status).toBe("completed");
  }, 20000);
});

function spawnCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawn(process.execPath, ["dist/interfaces/cli.js", ...args], {
    cwd: path.resolve("."),
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
}

function killProcessGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function onceExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve) => child.once("exit", (code) => resolve(code)));
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 5000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for killed task checkpoint.");
}
