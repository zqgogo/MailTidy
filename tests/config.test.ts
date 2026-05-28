import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadMailTidyConfig, resolveLLMConfig } from "../src/ops/config.js";

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mailtidy-config-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("MailTidy config", () => {
  it("uses heuristic defaults when no config file exists", async () => {
    await withTempDir(async (dir) => {
      const config = await loadMailTidyConfig(path.join(dir, "config.json"));
      expect(config.llm.provider).toBe("heuristic");
      expect(resolveLLMConfig(config)).toEqual({ provider: "heuristic" });
    });
  });

  it("loads provider and model from state config", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "config.json");
      await writeFile(file, JSON.stringify({ llm: { provider: "openai", model: "gpt-4.1-mini" } }), "utf-8");

      const config = await loadMailTidyConfig(file);

      expect(config.llm).toEqual({ provider: "openai", model: "gpt-4.1-mini" });
    });
  });

  it("lets CLI-style overrides win over persisted config", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "config.json");
      await writeFile(file, JSON.stringify({ llm: { provider: "openai", model: "gpt-4.1-mini" } }), "utf-8");

      const config = await loadMailTidyConfig(file);

      expect(resolveLLMConfig(config, { llmProvider: "anthropic", llmModel: "claude-3-5-haiku-latest" })).toEqual({
        provider: "anthropic",
        model: "claude-3-5-haiku-latest",
      });
    });
  });

  it("rejects unknown providers", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "config.json");
      await writeFile(file, JSON.stringify({ llm: { provider: "bogus" } }), "utf-8");

      await expect(loadMailTidyConfig(file)).rejects.toThrow("Invalid LLM provider");
    });
  });
});
