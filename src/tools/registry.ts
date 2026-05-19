import type { LLMClient } from "../llm/client.js";
import type { EmailConnector } from "../integrations/email/base.js";
import type { Prompter } from "../interfaces/prompts.js";
import type { AnyToolDefinition } from "./base.js";
import { createActionTools } from "./actions.js";
import { createClassificationTools } from "./classify.js";
import { createEmailTools } from "./email.js";
import { createUserTools } from "./user.js";

export interface ToolRegistryDeps {
  connector: EmailConnector;
  llm: LLMClient;
  prompter?: Prompter;
}

export function createMailTidyTools(deps: ToolRegistryDeps): AnyToolDefinition[] {
  const tools = [
    ...createEmailTools(deps.connector),
    ...createClassificationTools(deps.llm),
    ...createActionTools(deps.connector),
  ];
  if (deps.prompter) tools.push(...createUserTools(deps.prompter));
  return tools;
}
