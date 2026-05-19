import type { LLMClient } from "../llm/client.js";
import type { EmailConnector } from "../integrations/email/base.js";
import type { Prompter } from "../interfaces/prompts.js";
import type { AgentMemory } from "../data/memory.js";
import type { AnyToolDefinition } from "./base.js";
import { createActionTools } from "./actions.js";
import { createClassificationTools } from "./classify.js";
import { createEmailTools } from "./email.js";
import { createHistoryTools } from "./history.js";
import { createMemoryTools } from "./memory.js";
import { createResearchTools } from "./research.js";
import { createRulesTools } from "./rules.js";
import { createUserTools } from "./user.js";

export interface ToolRegistryDeps {
  connector: EmailConnector;
  llm: LLMClient;
  /** prompter 缺省时 ask_user 工具不注册（CI / 非交互场景）。 */
  prompter?: Prompter;
  /** memory 缺省时不注册 memory tools（让主循环也能跑 read-only 任务）。 */
  memory?: AgentMemory;
  /** history tool 需要知道 state 目录（默认 .mailtidy）。 */
  stateDir?: string;
}

/**
 * 构造完整工具集，按"低风险读 → 决策 → 高风险写 → 交互 / 受限通道"顺序排列，
 * 便于主循环日志和 trace 展示更可读。
 *
 * 工具风险分布（§2.9）：
 *   low : fetch_recent_email, search_email, classify_email,
 *         match_rules, recall_memory, read_trace_slice,
 *         read_report_summary, read_original_record
 *   medium: ask_user, verify_domain
 *   high : apply_email_action, write_memory, web_search
 */
export function createMailTidyTools(deps: ToolRegistryDeps): AnyToolDefinition[] {
  const tools: AnyToolDefinition[] = [
    ...createEmailTools(deps.connector),
    ...createClassificationTools(deps.llm),
    ...createRulesTools(),
    ...createHistoryTools({ stateDir: deps.stateDir ?? ".mailtidy" }),
    ...createActionTools(deps.connector),
    ...createResearchTools(),
  ];
  if (deps.memory) tools.push(...createMemoryTools(deps.memory));
  if (deps.prompter) tools.push(...createUserTools(deps.prompter));
  return tools;
}
