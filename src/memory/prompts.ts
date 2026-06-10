/**
 * 记忆引擎使用的提示词模板
 */

export const PROMPTS = {
  /**
   * 经验总结提示词
   * 
   * 将用户行为转化为可复用的经验知识
   */
  EXPERIENCE_SUMMARY: `
你是一个邮件处理专家。请将以下用户行为总结为一条有价值的经验知识。

规则：
1. 不要记录具体操作，要记录经验
2. 使用"用户倾向"、"用户认为"等表述
3. 提取发件人域名或类型
4. 简洁明了，不超过一句话

用户行为：
邮件发件人：{sender}
邮件主题：{subject}
用户操作：{action}

请输出：
`,

  /**
   * 搜索查询生成提示词
   * 
   * 根据邮件内容生成检索查询
   */
  SEARCH_QUERY_GENERATION: `
你是一个邮件处理专家。请根据以下邮件信息生成一个检索查询，用于查找相关的历史经验。

邮件信息：
发件人：{sender}
主题：{subject}
内容摘要：{snippet}

请输出一个简洁的检索查询（不超过20个词）：
`,

  /**
   * 决策辅助提示词
   * 
   * 根据历史经验辅助当前决策
   */
  DECISION_ASSISTANCE: `
你是一个邮件处理助手。请根据以下历史经验，为当前邮件提供处理建议。

当前邮件：
发件人：{sender}
主题：{subject}

历史经验：
{experiences}

请输出：
1. 最相关的经验
2. 建议的操作
3. 操作理由
`,
};

/**
 * 生成经验总结提示词
 */
export function generateExperienceSummaryPrompt(
  sender: string,
  subject: string,
  action: string
): string {
  return PROMPTS.EXPERIENCE_SUMMARY
    .replace("{sender}", sender)
    .replace("{subject}", subject)
    .replace("{action}", action);
}

/**
 * 生成搜索查询提示词
 */
export function generateSearchQueryPrompt(
  sender: string,
  subject: string,
  snippet: string
): string {
  return PROMPTS.SEARCH_QUERY_GENERATION
    .replace("{sender}", sender)
    .replace("{subject}", subject)
    .replace("{snippet}", snippet);
}