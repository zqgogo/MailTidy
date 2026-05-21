import { getModels, type Api, type Model } from "@earendil-works/pi-ai";
import { PiLLMClient, type PiComplete } from "./piClient.js";

export interface AnthropicLLMClientOptions {
  modelId?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  complete?: PiComplete;
}

export class AnthropicLLMClient extends PiLLMClient {
  constructor(options: AnthropicLLMClientOptions = {}) {
    super({
      provider: "anthropic",
      model: resolveAnthropicModel(options.modelId ?? "claude-3-5-haiku-latest"),
      apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      complete: options.complete,
    });
  }
}

export function resolveAnthropicModel(modelId: string): Model<Api> {
  const model = getModels("anthropic").find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Unknown Anthropic model "${modelId}".`);
  return model as Model<Api>;
}
