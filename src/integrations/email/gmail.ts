/**
 * Gmail 连接器实现（Phase 4.1）
 * 
 * 第一阶段：只读模式，写动作全部抛出异常
 * 支持 OAuth 2.0 认证，使用 Google API Client
 * 
 * 注意：需要安装 googleapis 包：npm install googleapis
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { EmailConnector, FetchRecentOptions } from "./base.js";
import type { EmailMessage } from "../../data/models.js";

export interface GmailConnectorOptions {
  credentialsPath?: string;
  tokenPath?: string;
  stateDir?: string;
  scopes?: string[];
}

const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
];

const READ_ONLY_ERROR = "Gmail connector is in read-only mode. Write operations are not permitted in Phase 4.1.";

export class GmailConnector implements EmailConnector {
  private readonly credentialsPath: string;
  private readonly tokenPath: string;
  private readonly scopes: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private authClient: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private gmail: any = null;

  constructor(options: GmailConnectorOptions = {}) {
    const stateDir = options.stateDir ?? ".mailtidy";
    this.credentialsPath = options.credentialsPath ?? path.join(stateDir, "credentials.json");
    this.tokenPath = options.tokenPath ?? path.join(stateDir, "token.json");
    this.scopes = options.scopes ?? DEFAULT_SCOPES;
  }

  async initialize(): Promise<void> {
    try {
      // Dynamic import to handle optional dependency
      const googleapis = await import("googleapis");
      const google = googleapis.google;

      const credentials = await this.readCredentials();
      const auth = new google.auth.OAuth2(
        credentials.installed?.client_id ?? "",
        credentials.installed?.client_secret ?? "",
        "http://localhost:3000/oauth2callback"
      );

      try {
        const token = await fs.readFile(this.tokenPath, "utf-8");
        auth.setCredentials(JSON.parse(token));
      } catch {
        await this.generateAuthUrl(auth);
      }

      this.authClient = auth;
      this.gmail = google.gmail({ version: "v1", auth });
    } catch (error) {
      throw new Error(`Failed to initialize Gmail connector: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  private async readCredentials(): Promise<{ installed?: { client_id?: string; client_secret?: string } }> {
    try {
      const raw = await fs.readFile(this.credentialsPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      throw new Error(`Credentials file not found at ${this.credentialsPath}. Please follow the Google Cloud setup instructions.`);
    }
  }

  private async generateAuthUrl(auth: unknown): Promise<void> {
    const url = (auth as { generateAuthUrl: (config: unknown) => string }).generateAuthUrl({
      access_type: "offline",
      scope: this.scopes,
    });

    console.log("Authorize this app by visiting this url:", url);
    throw new Error("OAuth token not found. Please visit the URL above to authorize and save the token.");
  }

  async fetchRecent(options: FetchRecentOptions = {}): Promise<EmailMessage[]> {
    await this.ensureInitialized();

    const limit = options.limit ?? 50;
    const unreadOnly = options.unreadOnly ?? false;

    try {
      const query = unreadOnly ? "is:unread" : "";

      const res = await this.gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: limit,
        labelIds: ["INBOX"],
      });

      const messages = (res.data as { messages?: Array<{ id: string }> }).messages ?? [];
      const emailMessages: EmailMessage[] = [];

      for (const msg of messages) {
        const email = await this.readById(msg.id);
        if (email) {
          emailMessages.push(email);
        }
      }

      return emailMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } catch (error) {
      throw new Error(`Failed to fetch recent emails: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async search(query: string, months: number = 1): Promise<EmailMessage[]> {
    await this.ensureInitialized();

    try {
      const startTime = new Date();
      startTime.setMonth(startTime.getMonth() - months);

      const res = await this.gmail.users.messages.list({
        userId: "me",
        q: `${query} after:${Math.floor(startTime.getTime() / 1000)}`,
        maxResults: 50,
      });

      const messages = (res.data as { messages?: Array<{ id: string }> }).messages ?? [];
      const emailMessages: EmailMessage[] = [];

      for (const msg of messages) {
        const email = await this.readById(msg.id);
        if (email) {
          emailMessages.push(email);
        }
      }

      return emailMessages;
    } catch (error) {
      throw new Error(`Failed to search emails: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async readById(emailId: string): Promise<EmailMessage | null> {
    await this.ensureInitialized();

    try {
      const res = await this.gmail.users.messages.get({
        userId: "me",
        id: emailId,
        format: "full",
      });

      const message = res.data;
      if (!message) return null;

      return this.parseGmailMessage(message);
    } catch (error) {
      console.warn(`Failed to read email ${emailId}: ${error instanceof Error ? error.message : "Unknown error"}`);
      return null;
    }
  }

  async archive(_emailIds: string[]): Promise<void> {
    throw new Error(READ_ONLY_ERROR);
  }

  async label(_emailIds: string[], _label: string): Promise<void> {
    throw new Error(READ_ONLY_ERROR);
  }

  async star(_emailIds: string[]): Promise<void> {
    throw new Error(READ_ONLY_ERROR);
  }

  async markRead(_emailIds: string[]): Promise<void> {
    throw new Error(READ_ONLY_ERROR);
  }

  async saveDraft(_emailId: string, _body: string): Promise<void> {
    throw new Error(READ_ONLY_ERROR);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseGmailMessage(message: any): EmailMessage {
    const headers = message.payload?.headers ?? [];
    const getHeader = (name: string): string => {
      const header = headers.find((h: { name: string; value: string }) => h.name.toLowerCase() === name.toLowerCase());
      return header?.value ?? "";
    };

    const sender = getHeader("From");
    const subject = getHeader("Subject");
    const date = getHeader("Date");

    let body = "";
    if (message.payload?.body?.data) {
      body = Buffer.from(message.payload.body.data, "base64").toString("utf-8");
    } else if (message.payload?.parts) {
      const textPart = message.payload.parts.find((p: { mimeType: string }) => p.mimeType === "text/plain");
      if (textPart?.body?.data) {
        body = Buffer.from(textPart.body.data, "base64").toString("utf-8");
      }
    }

    const snippet = message.snippet ?? "";
    const hasAttachment = message.payload?.parts?.some((p: { filename: string }) => p.filename) ?? false;
    const labels = message.labelIds ?? [];
    const unread = labels.includes("UNREAD");

    return {
      id: message.id ?? "",
      sender: this.extractEmailFromHeader(sender),
      subject: subject,
      snippet: snippet,
      body: body,
      date: date,
      hasAttachment,
      unread,
      labels,
    };
  }

  private extractEmailFromHeader(header: string): string {
    const match = header.match(/<([^>]+)>/);
    return match ? (match[1] ?? header) : header;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.gmail) {
      await this.initialize();
    }
  }

  getAuthUrl(): string | null {
    if (!this.authClient) return null;

    return this.authClient.generateAuthUrl({
      access_type: "offline",
      scope: this.scopes,
    });
  }

  async refreshToken(): Promise<void> {
    if (!this.authClient) return;

    try {
      const { credentials } = await this.authClient.refreshAccessToken();
      await fs.writeFile(this.tokenPath, JSON.stringify(credentials), "utf-8");
    } catch (error) {
      throw new Error(`Failed to refresh token: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
}

export function createGmailConnector(options?: GmailConnectorOptions): GmailConnector {
  return new GmailConnector(options);
}