import type { Prompter } from "../interfaces/prompts.js";
import type { AnyToolDefinition } from "./base.js";

export interface AskUserArgs {
  question: string;
  defaultAnswer?: string;
}

export function createUserTools(prompter: Prompter): AnyToolDefinition[] {
  return [
    {
      name: "ask_user",
      description: "Ask the user for confirmation or missing information before risky or ambiguous work continues.",
      schema: {
        type: "object",
        required: ["question"],
        properties: {
          question: { type: "string", minLength: 1 },
          defaultAnswer: { type: "string" },
        },
        additionalProperties: false,
      },
      risk: "medium",
      rateLimit: { perTask: 8 },
      async invoke(args: AskUserArgs): Promise<{ answer: string }> {
        const answer = await prompter.ask(args.question);
        return { answer: answer || args.defaultAnswer || "" };
      },
    },
  ];
}
