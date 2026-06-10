import type { AnyToolDefinition } from "./base.js";
import type { MemoryIndex, SemanticMemoryQuery } from "../data/vector-index.js";
import type { MemoryItemType } from "../data/memory-items.js";

export interface SemanticRecallMemoryArgs {
  query: string;
  types?: MemoryItemType[];
  limit?: number;
  minScore?: number;
  sender?: string;
  domain?: string;
}

export interface SemanticRecallMemoryOptions {
  memoryIndex: MemoryIndex;
}

export function createSemanticMemoryTools(options: SemanticRecallMemoryOptions): AnyToolDefinition[] {
  const { memoryIndex } = options;

  return [
    {
      name: "semantic_recall_memory",
      description:
        "Search MailTidy memory semantically for similar past experiences, decisions, preferences, or writing styles. Use when you need contextual understanding of how similar emails or situations were handled before. Returns results with source IDs for traceability.",
      schema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1 },
          types: {
            type: "array",
            items: {
              type: "string",
              enum: ["decision", "preference_note", "email_summary", "style_sample", "subscription"],
            },
          },
          limit: { type: "number", minimum: 1, maximum: 20, default: 8 },
          minScore: { type: "number", minimum: 0, maximum: 1, default: 0.72 },
          sender: { type: "string" },
          domain: { type: "string" },
        },
        additionalProperties: false,
      },
      risk: "low",
      rateLimit: { perTask: 5 },
      async invoke(args: SemanticRecallMemoryArgs): Promise<unknown> {
        const query: SemanticMemoryQuery = {
          query: args.query,
          types: args.types,
          limit: args.limit,
          minScore: args.minScore,
          sender: args.sender,
          domain: args.domain,
        };

        const results = await memoryIndex.search(query);

        return {
          results: results.map((match) => ({
            sourceType: match.type,
            sourceId: match.sourceId,
            score: match.score,
            title: match.title,
            summary: match.summary,
            metadata: match.metadata,
          })),
          total: results.length,
        };
      },
    },
  ];
}