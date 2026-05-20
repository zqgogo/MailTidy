import { Type, type TSchema } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AnyToolDefinition } from "./base.js";

export interface PiToolAdapterOptions {
  /**
   * Tools that mutate mailbox state or must preserve ordering should run sequentially.
   * Read-only tools can keep pi-agent-core's default parallel execution.
   */
  sequentialHighRisk?: boolean;
}

export function toPiAgentTool(
  tool: AnyToolDefinition,
  options: PiToolAdapterOptions = {},
): AgentTool<TSchema, unknown> {
  const piTool: AgentTool<TSchema, unknown> = {
    name: tool.name,
    label: labelForTool(tool.name),
    description: tool.description,
    parameters: Type.Unsafe(tool.schema),
    async execute(_toolCallId, params, _signal): Promise<AgentToolResult<unknown>> {
      const result = await tool.invoke(params);
      return {
        content: [{ type: "text", text: summarizeToolResult(result) }],
        details: result,
      };
    },
  };

  if (options.sequentialHighRisk ?? true) {
    if (tool.risk === "high") piTool.executionMode = "sequential";
  }
  return piTool;
}

export function toPiAgentTools(
  tools: AnyToolDefinition[],
  options: PiToolAdapterOptions = {},
): AgentTool<TSchema, unknown>[] {
  return tools.map((tool) => toPiAgentTool(tool, options));
}

function labelForTool(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function summarizeToolResult(result: unknown): string {
  if (Array.isArray(result)) return `Returned ${result.length} item(s).`;
  if (result === null) return "Returned null.";
  if (typeof result === "object") return JSON.stringify(result);
  return String(result);
}
