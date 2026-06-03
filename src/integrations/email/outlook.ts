/**
 * Outlook 连接器实现（Phase 4.4）
 * 
 * 第一阶段：只读模式，写动作全部抛出异常
 * 支持 OAuth 2.0 认证，使用 Microsoft Graph API
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { EmailConnector, FetchRecentOptions } from "./base.js";
import type { EmailMessage } from "../../data/models.js";

export interface OutlookConnectorOptions {
  clientId?: string;
  clientSecret?: string;
  tokenPath?: string;
  stateDir?: string;
  scopes?: string[];
}

const DEFAULT_SCOPES = [
  "https://graph.microsoft.com/Mail.Read",
];

const READ_ONLY_ERROR = "Outlook connector is in read-only mode. Write operations are not permitted in Phase 4.4.";

export class OutlookConnector implements EmailConnector {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly tokenPath: string;
  private readonly scopes: string[];
  private accessToken: string = "";
  private tokenExpiresAt: number = 0;

  constructor(options: OutlookConnectorOptions = {}) {
    const stateDir = options.stateDir ?? ".mailtidy";
    this.clientId = options.clientId ?? "";
    this.clientSecret = options.clientSecret ?? "";
    this.tokenPath = options.tokenPath ?? path.join(stateDir, "outlook-token.json");
    this.scopes = options.scopes ?? DEFAULT_SCOPES;
  }

  async initialize(): Promise<void> {
    if (!this.clientId || !this.clientSecret) {
      throw new Error("Outlook client ID and secret are required. Please set them in the configuration.");
    }

    try {
      const token = await fs.readFile(this.tokenPath, "utf-8");
      const tokenData = JSON.parse(token);
      this.accessToken = tokenData.access_token;
      this.tokenExpiresAt = tokenData.expires_at ?? 0;
    } catch {
      throw new Error("Outlook token not found. Please run the OAuth flow to obtain a token.");
    }
  }

  async fetchRecent(options: FetchRecentOptions = {}): Promise<EmailMessage[]> {
    await this.ensureInitialized();
    await this.ensureTokenValid();

    const hours = options.hours ?? 24;
    const limit = options.limit ?? 50;

    try {
      const endpoint = `https://graph.microsoft.com/v1.0/me/mailfolders/inbox/messages?$top=${limit}&$orderby=receivedDateTime desc&$filter=receivedDateTime ge ${this.formatDateTime(new Date(Date.now() - hours * 3600000))}`;
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch emails: ${response.statusText}`);
      }

      const data = await response.json();
      return (data.value ?? []).map((msg: any) => this.parseOutlookMessage(msg));
    } catch (error) {
      throw new Error(`Failed to fetch recent emails: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async search(query: string, months: number = 1): Promise<EmailMessage[]> {
    await this.ensureInitialized();
    await this.ensureTokenValid();

    try {
      const startDate = new Date(Date.now() - months * 30 * 24 * 3600000);
      const endpoint = `https://graph.microsoft.com/v1.0/me/messages?$search="${encodeURIComponent(query)}"&$filter=receivedDateTime ge ${this.formatDateTime(startDate)}&$top=50`;
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (!response.ok) {
        throw new Error(`Failed to search emails: ${response.statusText}`);
      }

      const data = await response.json();
      return (data.value ?? []).map((msg: any) => this.parseOutlookMessage(msg));
    } catch (error) {
      throw new Error(`Failed to search emails: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async readById(emailId: string): Promise<EmailMessage | null> {
    await this.ensureInitialized();
    await this.ensureTokenValid();

    try {
      const endpoint = `https://graph.microsoft.com/v1.0/me/messages/${emailId}`;
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (!response.ok) {
        console.warn(`Failed to read email ${emailId}: ${response.statusText}`);
        return null;
      }

      const message = await response.json();
      return this.parseOutlookMessage(message);
    } catch (error) {
      console.warn(`Failed to read email ${emailId}: ${error instanceof Error ? error.message : "Unknown error"}`);
      return null;
    }
  }

  async archive(emailIds: string[]): Promise<void> {
    throw new Error(READ_ONLY_ERROR);
  }

  async label(emailIds: string[], label: string): Promise<void> {
    throw new Error(READ_ONLY_ERROR);
  }

  async star(emailIds: string[]): Promise<void> {
    throw new Error(READ_ONLY_ERROR);
  }

  async markRead(emailIds: string[]): Promise<void> {
    throw new Error(READ_ONLY_ERROR);
  }

  async saveDraft(emailId: string, body: string): Promise<void> {
    throw new Error(READ_ONLY_ERROR);
  }

  private parseOutlookMessage(message: any): EmailMessage {
    return {
      id: message.id,
      sender: message.from?.emailAddress?.address ?? "",
      subject: message.subject ?? "",
      snippet: message.bodyPreview ?? "",
      body: this.getBodyContent(message),
      date: message.receivedDateTime ?? new Date().toISOString(),
      hasAttachment: message.hasAttachments ?? false,
      unread: message.isRead ?? false,
      labels: [],
    };
  }

  private getBodyContent(message: any): string {
    if (message.body?.contentType === "text") {
      return message.body.content ?? "";
    }
    return message.bodyPreview ?? "";
  }

  private formatDateTime(date: Date): string {
    return date.toISOString();
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.accessToken) {
      await this.initialize();
    }
  }

  private async ensureTokenValid(): Promise<void> {
    if (Date.now() >= this.tokenExpiresAt) {
      await this.refreshToken();
    }
  }

  private async refreshToken(): Promise<void> {
    try {
      const response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "refresh_token",
          refresh_token: await this.getRefreshToken(),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to refresh token");
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);

      await fs.writeFile(this.tokenPath, JSON.stringify({
        access_token: this.accessToken,
        expires_at: this.tokenExpiresAt,
        refresh_token: data.refresh_token,
      }), "utf-8");
    } catch (error) {
      throw new Error(`Failed to refresh token: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  private async getRefreshToken(): Promise<string> {
    const token = await fs.readFile(this.tokenPath, "utf-8");
    const tokenData = JSON.parse(token);
    return tokenData.refresh_token ?? "";
  }

  getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: "http://localhost:3000/oauth2callback",
      scope: this.scopes.join(" "),
      access_type: "offline",
    });

    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  }
}

export function createOutlookConnector(options?: OutlookConnectorOptions): OutlookConnector {
  return new OutlookConnector(options);
}