/**
 * 邮件连接器抽象：Agent 与外部邮箱之间唯一的 IO 边界。
 *
 * 设计原则：
 *   - 接口只暴露最小必需动作（fetch / search / archive / label / star /
 *     markRead / saveDraft）。
 *   - **永远不暴露 send 接口**：从架构上杜绝"自动替用户发邮件"。
 *   - 写动作支持批量 emailIds，方便未来对接 Gmail batch API 节省调用量。
 *
 * 接入真实 Gmail / Outlook 时按以下步骤：
 *   1. 在 `integrations/email/{gmail,outlook}.ts` 实现 EmailConnector。
 *   2. 第一阶段只实现读权限，写动作直接 throw。
 *   3. 跑 run-cleanup 验证分类质量后，再逐步开放写权限。
 */

import type { EmailMessage } from "../../data/models.js";

export interface FetchRecentOptions {
  hours?: number;
  limit?: number;
  unreadOnly?: boolean;
}

export interface EmailConnector {
  fetchRecent(options?: FetchRecentOptions): Promise<EmailMessage[]>;
  search(query: string, months?: number): Promise<EmailMessage[]>;
  readById(emailId: string): Promise<EmailMessage | null>;
  archive(emailIds: string[]): Promise<void>;
  label(emailIds: string[], label: string): Promise<void>;
  star(emailIds: string[]): Promise<void>;
  markRead(emailIds: string[]): Promise<void>;
  saveDraft(emailId: string, body: string): Promise<void>;
}
