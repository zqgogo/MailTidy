/**
 * 模型路由与降级策略。
 * Router 不直接实现模型能力，只按用途选择 client。
 */

import type { LLMClient } from "./client.js";

export interface ModelRoute {
  purpose: string;
  primary: string;
  fallback?: string;
  maxInputTokens?: number;
}

export class LLMRouter {
  constructor(
    private readonly clients: Record<string, LLMClient>,
    private readonly routes: Record<string, ModelRoute> = {},
    private readonly defaultModel: string = "heuristic",
  ) {}

  clientFor(purpose: string): LLMClient {
    const route = this.routes[purpose];
    const name = route?.primary ?? this.defaultModel;
    const client = this.clients[name];
    if (!client) throw new Error(`No LLM client registered under name "${name}"`);
    return client;
  }

  fallbackFor(purpose: string): LLMClient | null {
    const route = this.routes[purpose];
    if (!route?.fallback) return null;
    return this.clients[route.fallback] ?? null;
  }
}
