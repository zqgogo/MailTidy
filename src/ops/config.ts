import { readFile } from "node:fs/promises";

export type LLMProviderName = "heuristic" | "openai" | "anthropic";

export interface LLMConfig {
  provider: LLMProviderName;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
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
  };
}

export function parseLLMProvider(value: string): LLMProviderName {
  if (value === "heuristic" || value === "openai" || value === "anthropic") return value;
  throw new Error(`Invalid LLM provider "${value}". Expected heuristic, openai, or anthropic.`);
}

export function parseEmailProvider(value: string): EmailProviderName {
  if (value === "mock" || value === "gmail" || value === "outlook") return value;
  throw new Error(`Invalid email provider "${value}". Expected mock, gmail, or outlook.`);
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