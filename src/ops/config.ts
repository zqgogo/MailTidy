import { readFile } from "node:fs/promises";

export type LLMProviderName = "heuristic" | "openai" | "anthropic";

export interface LLMConfig {
  provider: LLMProviderName;
  model?: string;
}

export interface MailTidyConfig {
  llm: LLMConfig;
}

export interface ConfigOverrides {
  llmProvider?: string;
  llmModel?: string;
}

export const defaultConfig: MailTidyConfig = {
  llm: { provider: "heuristic" },
};

export async function loadMailTidyConfig(path: string): Promise<MailTidyConfig> {
  const raw = await readFile(path, "utf-8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  });
  if (raw === null) return normalizeConfig({});
  const parsed = JSON.parse(raw) as Partial<MailTidyConfig>;
  return normalizeConfig(parsed);
}

export function resolveLLMConfig(config: MailTidyConfig, overrides: ConfigOverrides = {}): LLMConfig {
  return {
    provider: overrides.llmProvider ? parseLLMProvider(overrides.llmProvider) : config.llm.provider,
    model: overrides.llmModel ?? config.llm.model,
  };
}

export function parseLLMProvider(value: string): LLMProviderName {
  if (value === "heuristic" || value === "openai" || value === "anthropic") return value;
  throw new Error(`Invalid LLM provider "${value}". Expected heuristic, openai, or anthropic.`);
}

function normalizeConfig(input: Partial<MailTidyConfig>): MailTidyConfig {
  return {
    llm: {
      provider: input.llm?.provider ? parseLLMProvider(input.llm.provider) : defaultConfig.llm.provider,
      model: input.llm?.model,
    },
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
