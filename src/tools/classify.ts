import type { EmailJudgment, EmailMessage } from "../data/models.js";
import type { LLMClient } from "../llm/client.js";
import type { AnyToolDefinition } from "./base.js";

export interface ClassifyEmailArgs {
  message: EmailMessage;
  customDimensions?: string[];
}

export interface DraftReplyArgs {
  message: EmailMessage;
}

export function createClassificationTools(llm: LLMClient): AnyToolDefinition[] {
  return [
    {
      name: "classify_email",
      description: "Classify one email into MailTidy categories with confidence, urgency, reason, and action suggestion.",
      schema: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "object" },
          customDimensions: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
      risk: "low",
      invoke(args: ClassifyEmailArgs): Promise<EmailJudgment> {
        return llm.classifyEmail(args.message, args.customDimensions);
      },
    },
  ];
}
