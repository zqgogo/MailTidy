import type { EmailJudgment, EmailMessage, StyleProfile } from "../../data/models.js";
import type { LLMClient, ModelProfile } from "../../llm/client.js";

export interface FallbackLLMClientOptions {
  primary: LLMClient;
  fallback: LLMClient;
  onFallback?: (details: { method: string; error: unknown; primary: ModelProfile; fallback: ModelProfile }) => void;
}

export class FallbackLLMClient implements LLMClient {
  readonly profile: ModelProfile;

  constructor(private readonly options: FallbackLLMClientOptions) {
    this.profile = {
      ...options.primary.profile,
      name: `${options.primary.profile.name}+fallback:${options.fallback.profile.name}`,
    };
  }

  async classifyEmail(message: EmailMessage, customDimensions?: string[]): Promise<EmailJudgment> {
    return this.withFallback("classifyEmail", (client) => client.classifyEmail(message, customDimensions));
  }

  async draftReply(message: EmailMessage, style: StyleProfile): Promise<string> {
    return this.withFallback("draftReply", (client) => client.draftReply(message, style));
  }

  async summarizeNewsletters(messages: EmailMessage[]): Promise<string> {
    return this.withFallback("summarizeNewsletters", (client) => client.summarizeNewsletters(messages));
  }

  private async withFallback<T>(method: string, run: (client: LLMClient) => Promise<T>): Promise<T> {
    try {
      return await run(this.options.primary);
    } catch (error) {
      this.options.onFallback?.({
        method,
        error,
        primary: this.options.primary.profile,
        fallback: this.options.fallback.profile,
      });
      return run(this.options.fallback);
    }
  }
}
