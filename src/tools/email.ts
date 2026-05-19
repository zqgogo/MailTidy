import type { EmailMessage } from "../data/models.js";
import type { EmailConnector, FetchRecentOptions } from "../integrations/email/base.js";
import type { AnyToolDefinition } from "./base.js";

export interface SearchEmailArgs {
  query: string;
  months?: number;
}

export function createEmailTools(connector: EmailConnector): AnyToolDefinition[] {
  return [
    {
      name: "fetch_recent_email",
      description: "Fetch recent mailbox messages for triage or briefing. Returns message metadata plus available snippets/body.",
      schema: {
        type: "object",
        properties: {
          hours: { type: "number", minimum: 1, maximum: 720 },
          limit: { type: "number", minimum: 1, maximum: 500 },
          unreadOnly: { type: "boolean" },
        },
        additionalProperties: false,
      },
      risk: "low",
      rateLimit: { perTask: 20 },
      invoke(args: FetchRecentOptions = {}): Promise<EmailMessage[]> {
        return connector.fetchRecent(args);
      },
    },
    {
      name: "search_email",
      description: "Search mailbox messages by query for receipts, subscriptions, threads, or evidence lookup.",
      schema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1 },
          months: { type: "number", minimum: 1, maximum: 60 },
        },
        additionalProperties: false,
      },
      risk: "low",
      rateLimit: { perTask: 25 },
      invoke(args: SearchEmailArgs): Promise<EmailMessage[]> {
        return connector.search(args.query, args.months);
      },
    },
  ];
}
