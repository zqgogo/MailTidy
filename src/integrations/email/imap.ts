/**
 * IMAP 邮件连接器（支持 QQ 邮箱、网易邮箱等）
 * 
 * QQ 邮箱配置说明：
 *   1. 登录 QQ 邮箱 → 设置 → 账户
 *   2. 开启 IMAP/SMTP 服务
 *   3. 获取授权码（非密码）
 *   4. 服务器: imap.qq.com, 端口: 993 (SSL)
 */

import { ImapFlow } from "imapflow";
import type { EmailConnector, FetchRecentOptions } from "./base.js";
import type { EmailMessage } from "../../data/models.js";

export interface ImapConnectorConfig {
  host: string;
  port?: number;
  secure?: boolean;
  user: string;
  password: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

export class ImapConnector implements EmailConnector {
  private client: ImapFlow | null = null;
  private config: ImapConnectorConfig;
  private connected: boolean = false;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(config: ImapConnectorConfig) {
    this.config = {
      host: config.host,
      port: config.port ?? 993,
      secure: config.secure ?? true,
      user: config.user,
      password: config.password,
    };
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
  }

  private async connect(): Promise<ImapFlow> {
    if (this.client && this.connected) {
      return this.client;
    }

    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this.client = new ImapFlow({
          host: this.config.host,
          port: this.config.port as number,
          secure: this.config.secure,
          auth: {
            user: this.config.user,
            pass: this.config.password,
          },
          logger: false,
        });

        await this.client.connect();
        this.connected = true;
        return this.client;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < this.maxRetries) {
          console.warn(`IMAP connection attempt ${attempt}/${this.maxRetries} failed: ${lastError.message}`);
          console.warn(`Retrying in ${this.retryDelayMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, this.retryDelayMs));
        }
      } finally {
        if (!this.connected && this.client) {
          try {
            await this.client.logout();
          } catch {
            // Ignore logout error
          }
          this.client = null;
        }
      }
    }

    throw lastError ?? new Error("IMAP connection failed");
  }

  async fetchRecent(options: FetchRecentOptions = {}): Promise<EmailMessage[]> {
    const client = await this.connect();
    const messages: EmailMessage[] = [];

    try {
      const mailbox = await client.getMailboxLock("INBOX");
      try {
        const limit = options.limit ?? 20;
        
        const searchQuery: Record<string, unknown> = {};
        if (options.unreadOnly) {
          searchQuery["unseen"] = true;
        }

        let count = 0;
        for await (const message of client.fetch(searchQuery, {
          uid: true,
          envelope: true,
          flags: true,
          internalDate: true,
        })) {
          if (count >= limit) break;
          const email = this.parseEmail(message);
          if (email) {
            messages.push(email);
            count++;
          }
        }
      } finally {
        mailbox.release();
      }
    } catch (error) {
      console.error("IMAP fetch error:", error);
      throw error;
    }

    return messages;
  }

  async search(query: string, months: number = 1): Promise<EmailMessage[]> {
    const client = await this.connect();
    const messages: EmailMessage[] = [];

    try {
      const mailbox = await client.getMailboxLock("INBOX");
      try {
        const date = new Date();
        date.setMonth(date.getMonth() - months);
        const sinceDate = date.toISOString().split("T")[0];

        const searchQuery: Record<string, unknown> = {
          since: sinceDate,
          search: query,
        };

        for await (const message of client.fetch(searchQuery, {
          uid: true,
          envelope: true,
          flags: true,
          internalDate: true,
        })) {
          const email = this.parseEmail(message);
          if (email) {
            messages.push(email);
          }
        }
      } finally {
        mailbox.release();
      }
    } catch (error) {
      console.error("IMAP search error:", error);
      throw error;
    }

    return messages;
  }

  async readById(emailId: string): Promise<EmailMessage | null> {
    const client = await this.connect();

    try {
      const mailbox = await client.getMailboxLock("INBOX");
      try {
        const uid = parseInt(emailId, 10);
        if (isNaN(uid)) return null;
        
        for await (const message of client.fetch({ uid }, {
          uid: true,
          envelope: true,
          flags: true,
          internalDate: true,
          bodyStructure: true,
        })) {
          return this.parseEmail(message);
        }
      } finally {
        mailbox.release();
      }
    } catch (error) {
      console.error("IMAP read error:", error);
    }

    return null;
  }

  async archive(emailIds: string[]): Promise<void> {
    const client = await this.connect();

    try {
      const uids = emailIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
      
      const mailbox = await client.getMailboxLock("INBOX");
      try {
        await client.messageMove(uids, "Archive");
      } finally {
        mailbox.release();
      }
    } catch (error) {
      console.error("IMAP archive error:", error);
      throw error;
    }
  }

  async label(emailIds: string[], label: string): Promise<void> {
    const client = await this.connect();

    try {
      const uids = emailIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
      
      const mailbox = await client.getMailboxLock("INBOX");
      try {
        const labelFolder = `MailTidy/${label}`;
        await client.mailboxCreate(labelFolder);
        await client.messageCopy(uids, labelFolder);
      } finally {
        mailbox.release();
      }
    } catch (error) {
      console.error("IMAP label error:", error);
      throw error;
    }
  }

  async star(emailIds: string[]): Promise<void> {
    const client = await this.connect();

    try {
      const uids = emailIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
      
      const mailbox = await client.getMailboxLock("INBOX");
      try {
        await client.messageFlagsAdd(uids, ["\\Flagged"]);
      } finally {
        mailbox.release();
      }
    } catch (error) {
      console.error("IMAP star error:", error);
      throw error;
    }
  }

  async markRead(emailIds: string[]): Promise<void> {
    const client = await this.connect();

    try {
      const uids = emailIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
      
      const mailbox = await client.getMailboxLock("INBOX");
      try {
        await client.messageFlagsAdd(uids, ["\\Seen"]);
      } finally {
        mailbox.release();
      }
    } catch (error) {
      console.error("IMAP markRead error:", error);
      throw error;
    }
  }

  async saveDraft(emailId: string, body: string): Promise<void> {
    throw new Error("saveDraft is not implemented for IMAP");
  }

  private parseEmail(message: {
    uid: number;
    envelope?: {
      from?: Array<{ name?: string; address?: string }>;
      to?: Array<{ name?: string; address?: string }>;
      subject?: string;
      date?: Date;
    };
    flags?: Set<string>;
    internalDate?: string | Date;
  }): EmailMessage | null {
    try {
      const from = message.envelope?.from?.[0];
      const internalDate = typeof message.internalDate === "string" ? new Date(message.internalDate) : message.internalDate;

      return {
        id: String(message.uid),
        sender: from?.address || "",
        subject: message.envelope?.subject || "",
        snippet: "",
        date: (internalDate || message.envelope?.date || new Date()).toISOString(),
        unread: !(message.flags?.has("\\Seen") ?? false),
        labels: [],
      };
    } catch {
      return null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.logout();
      this.client = null;
      this.connected = false;
    }
  }
}

export function createImapConnector(config: ImapConnectorConfig): ImapConnector {
  return new ImapConnector(config);
}