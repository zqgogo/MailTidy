import { readFile } from "node:fs/promises";

export type LLMProviderName = "heuristic" | "openai" | "anthropic" | "zhipu";

export interface LLMConfig {
  provider: LLMProviderName;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export type EmbeddingProviderName = "heuristic" | "openai" | "local";

export interface EmbeddingConfig {
  provider: EmbeddingProviderName;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  dimensions?: number;
  minScore?: number;
  maxResults?: number;
}

export type EmailProviderName = "mock" | "gmail" | "outlook" | "imap";

export interface GmailConnectorConfig {
  credentialsPath?: string;
  tokenPath?: string;
  scopes?: string[];
}

export interface OutlookConnectorConfig {
  clientId?: string;
  clientSecret?: string;
  tokenPath?: string;
  scopes?: string[];
}

export interface ImapConnectorConfig {
  host: string;
  port?: number;
  secure?: boolean;
  user: string;
  password: string;
}

export interface EmailConfig {
  provider: EmailProviderName;
  gmail?: GmailConnectorConfig;
  outlook?: OutlookConnectorConfig;
  imap?: ImapConnectorConfig;
}

export interface SelfAwarenessConfig {
  enabled?: boolean;
  maxHistorySize?: number;
  stalePreferenceThresholdDays?: number;
  lowConfidenceThreshold?: number;
}

export interface MailTidyConfig {
  llm: LLMConfig;
  email: EmailConfig;
  embedding?: EmbeddingConfig;
  selfAwareness?: SelfAwarenessConfig;
  stateDir?: string;
  dryRun?: boolean;
}

export interface ConfigOverrides {
  llmProvider?: string;
  llmModel?: string;
  emailProvider?: string;
  dryRun?: boolean;
}

export const defaultConfig: MailTidyConfig = {
  llm: { provider: "heuristic" },
  email: { provider: "mock" },
  embedding: {
    provider: "heuristic",
    model: "heuristic",
    minScore: 0.72,
    maxResults: 8,
    dimensions: 384,
  },
  selfAwareness: {
    enabled: true,
    maxHistorySize: 1000,
    stalePreferenceThresholdDays: 90,
    lowConfidenceThreshold: 0.5,
  },
  stateDir: ".mailtidy",
  dryRun: false,
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
    apiKey: config.llm.apiKey,
    baseUrl: config.llm.baseUrl,
  };
}

export function resolveEmailConfig(config: MailTidyConfig, overrides: ConfigOverrides = {}): EmailConfig {
  const provider = overrides.emailProvider ? parseEmailProvider(overrides.emailProvider) : config.email.provider;
  
  return {
    provider,
    gmail: config.email.gmail,
    outlook: config.email.outlook,
    imap: config.email.imap,
  };
}

export function parseLLMProvider(value: string): LLMProviderName {
  if (value === "heuristic" || value === "openai" || value === "anthropic" || value === "zhipu") return value;
  throw new Error(`Invalid LLM provider "${value}". Expected heuristic, openai, anthropic, or zhipu.`);
}

export function parseEmailProvider(value: string): EmailProviderName {
  if (value === "mock" || value === "gmail" || value === "outlook" || value === "imap") return value;
  throw new Error(`Invalid email provider "${value}". Expected mock, gmail, outlook, or imap.`);
}

export function parseEmbeddingProvider(value: string): EmbeddingProviderName {
  if (value === "heuristic" || value === "openai" || value === "local") return value;
  throw new Error(`Invalid embedding provider "${value}". Expected heuristic, openai, or local.`);
}

export function resolveEmbeddingConfig(config: MailTidyConfig): EmbeddingConfig {
  return {
    provider: config.embedding?.provider ?? defaultConfig.embedding!.provider,
    model: config.embedding?.model ?? defaultConfig.embedding!.model,
    apiKey: config.embedding?.apiKey,
    baseUrl: config.embedding?.baseUrl,
    dimensions: config.embedding?.dimensions ?? defaultConfig.embedding!.dimensions,
    minScore: config.embedding?.minScore ?? defaultConfig.embedding!.minScore,
    maxResults: config.embedding?.maxResults ?? defaultConfig.embedding!.maxResults,
  };
}

export function getStateDir(config: MailTidyConfig): string {
  return config.stateDir ?? defaultConfig.stateDir!;
}

function normalizeConfig(input: Partial<MailTidyConfig>): MailTidyConfig {
  return {
    llm: {
      provider: input.llm?.provider ? parseLLMProvider(input.llm.provider) : defaultConfig.llm.provider,
      model: input.llm?.model,
      apiKey: input.llm?.apiKey,
      baseUrl: input.llm?.baseUrl,
    },
    email: {
      provider: input.email?.provider ? parseEmailProvider(input.email.provider) : defaultConfig.email.provider,
      gmail: input.email?.gmail,
      outlook: input.email?.outlook,
      imap: input.email?.imap,
    },
    embedding: {
      provider: input.embedding?.provider ? parseEmbeddingProvider(input.embedding.provider) : defaultConfig.embedding!.provider,
      model: input.embedding?.model ?? defaultConfig.embedding!.model,
      apiKey: input.embedding?.apiKey,
      baseUrl: input.embedding?.baseUrl,
      dimensions: input.embedding?.dimensions ?? defaultConfig.embedding!.dimensions,
      minScore: input.embedding?.minScore ?? defaultConfig.embedding!.minScore,
      maxResults: input.embedding?.maxResults ?? defaultConfig.embedding!.maxResults,
    },
    selfAwareness: {
      enabled: input.selfAwareness?.enabled ?? defaultConfig.selfAwareness?.enabled,
      maxHistorySize: input.selfAwareness?.maxHistorySize ?? defaultConfig.selfAwareness?.maxHistorySize,
      stalePreferenceThresholdDays: input.selfAwareness?.stalePreferenceThresholdDays ?? defaultConfig.selfAwareness?.stalePreferenceThresholdDays,
      lowConfidenceThreshold: input.selfAwareness?.lowConfidenceThreshold ?? defaultConfig.selfAwareness?.lowConfidenceThreshold,
    },
    stateDir: input.stateDir ?? defaultConfig.stateDir,
    dryRun: input.dryRun ?? defaultConfig.dryRun,
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}