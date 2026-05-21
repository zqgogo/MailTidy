import { getModels, type Api, type Model } from "@earendil-works/pi-ai";
import { PiLLMClient, type PiComplete } from "./piClient.js";

export interface OpenAILLMClientOptions {
  modelId?: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  complete?: PiComplete;
}

export class OpenAILLMClient extends PiLLMClient {
  constructor(options: OpenAILLMClientOptions = {}) {
    super({
      provider: "openai",
      model: resolveOpenAIModel(options.modelId ?? "gpt-4.1-mini"),
      apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      complete: options.complete,
    });
  }
}

export function resolveOpenAIModel(modelId: string): Model<Api> {
  const model = getModels("openai").find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Unknown OpenAI model "${modelId}".`);
  return model as Model<Api>;
}
