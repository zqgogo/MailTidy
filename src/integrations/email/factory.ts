/**
 * Email Connector 工厂函数
 * 
 * 根据配置统一创建 EmailConnector 实例，支持：
 * - mock: MockEmailConnector (用于测试/demo)
 * - imap: ImapConnector (QQ邮箱、网易邮箱、企业邮箱等)
 * - gmail: GmailConnector (需要 OAuth 配置)
 * - outlook: OutlookConnector (需要 OAuth 配置)
 * 
 * 使用方式：
 * const connector = buildEmailConnector(emailConfig, stateDir);
 */

import type { EmailConnector } from "./base.js";
import { MockEmailConnector } from "./mock.js";
import { ImapConnector, type ImapConnectorConfig } from "./imap.js";
import { GmailConnector } from "./gmail.js";
import { OutlookConnector } from "./outlook.js";
import type { EmailConfig } from "../../ops/config.js";
import * as fs from "fs";

export interface EmailConnectorOptions {
  stateDir?: string;
}

/**
 * 验证 IMAP 配置完整性
 */
function validateImapConfig(config: EmailConfig): void {
  if (!config.imap) {
    throw new Error("IMAP configuration is required but not provided");
  }
  
  const { host, user, password } = config.imap;
  
  if (!host || host.trim() === "") {
    throw new Error("IMAP host is required");
  }
  
  if (!user || user.trim() === "") {
    throw new Error("IMAP user (email address) is required");
  }
  
  if (!password || password.trim() === "") {
    throw new Error("IMAP password/auth code is required");
  }
}

/**
 * 从环境变量获取 IMAP 配置
 */
function getImapConfigFromEnv(config: EmailConfig): EmailConfig {
  const env = process.env;
  
  return {
    ...config,
    imap: {
      ...config.imap,
      host: (env.IMAP_HOST ?? config.imap?.host) || "",
      port: env.IMAP_PORT ? parseInt(env.IMAP_PORT, 10) : config.imap?.port,
      secure: env.IMAP_SECURE !== undefined ? env.IMAP_SECURE === "true" : config.imap?.secure,
      user: (env.IMAP_USER ?? config.imap?.user) || "",
      password: (env.IMAP_PASSWORD ?? env.IMAP_AUTH_CODE ?? config.imap?.password) || "",
    },
  };
}

/**
 * 验证 Gmail 配置完整性
 */
function validateGmailConfig(config: EmailConfig, stateDir: string): void {
  if (!config.gmail) {
    throw new Error("Gmail configuration is required but not provided");
  }
  
  const credentialsPath = config.gmail.credentialsPath ?? `${stateDir}/credentials.json`;
  const tokenPath = config.gmail.tokenPath ?? `${stateDir}/token.json`;
  
  try {
    fs.accessSync(credentialsPath);
  } catch {
    throw new Error(`Gmail credentials file not found at ${credentialsPath}. Please follow the setup instructions.`);
  }
  
  try {
    fs.accessSync(tokenPath);
  } catch {
    console.warn(`Gmail token file not found at ${tokenPath}. You will need to run 'gmail-auth' command first.`);
  }
}

/**
 * 验证 Outlook 配置完整性
 */
function validateOutlookConfig(config: EmailConfig, stateDir: string): void {
  if (!config.outlook) {
    throw new Error("Outlook configuration is required but not provided");
  }
  
  const { clientId, clientSecret } = config.outlook;
  
  if (!clientId || clientId.trim() === "") {
    throw new Error("Outlook client ID is required");
  }
  
  if (!clientSecret || clientSecret.trim() === "") {
    throw new Error("Outlook client secret is required");
  }
  
  const tokenPath = config.outlook.tokenPath ?? `${stateDir}/outlook-token.json`;
  try {
    fs.accessSync(tokenPath);
  } catch {
    console.warn(`Outlook token file not found at ${tokenPath}. You will need to run 'outlook-auth' command first.`);
  }
}

/**
 * 构建 Email Connector 工厂函数
 * 
 * @param config EmailConfig - 邮箱配置
 * @param stateDir string - 状态目录（用于存储 token 等文件）
 * @returns EmailConnector 实例
 */
export function buildEmailConnector(config: EmailConfig, stateDir: string = ".mailtidy"): EmailConnector {
  switch (config.provider) {
    case "mock":
      return new MockEmailConnector();
    
    case "imap":
      const imapConfig = getImapConfigFromEnv(config);
      validateImapConfig(imapConfig);
      return new ImapConnector({
        host: imapConfig.imap!.host,
        port: imapConfig.imap!.port ?? 993,
        secure: imapConfig.imap!.secure ?? true,
        user: imapConfig.imap!.user,
        password: imapConfig.imap!.password,
        maxRetries: 3,
        retryDelayMs: 2000,
      });
    
    case "gmail":
      validateGmailConfig(config, stateDir);
      return new GmailConnector({
        credentialsPath: config.gmail?.credentialsPath,
        tokenPath: config.gmail?.tokenPath,
        stateDir,
        scopes: config.gmail?.scopes,
      });
    
    case "outlook":
      validateOutlookConfig(config, stateDir);
      return new OutlookConnector({
        clientId: config.outlook?.clientId,
        clientSecret: config.outlook?.clientSecret,
        tokenPath: config.outlook?.tokenPath,
        stateDir,
        scopes: config.outlook?.scopes,
      });
    
    default:
      throw new Error(`Unsupported email provider: ${config.provider}`);
  }
}

/**
 * 检查邮箱配置是否完整（用于 email-smoke 命令前的快速检查）
 */
export function validateEmailConfig(config: EmailConfig, stateDir: string = ".mailtidy"): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  try {
    switch (config.provider) {
      case "mock":
        break;
      case "imap":
        const imapConfig = getImapConfigFromEnv(config);
        validateImapConfig(imapConfig);
        break;
      case "gmail":
        validateGmailConfig(config, stateDir);
        break;
      case "outlook":
        validateOutlookConfig(config, stateDir);
        break;
      default:
        errors.push(`Unknown email provider: ${config.provider}`);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 获取支持的邮箱提供商列表
 */
export function getSupportedEmailProviders(): string[] {
  return ["mock", "imap", "gmail", "outlook"];
}

/**
 * 获取邮箱提供商的描述
 */
export function getEmailProviderDescription(provider: string): string {
  const descriptions: Record<string, string> = {
    mock: "Mock connector (for testing/demo)",
    imap: "IMAP connector (QQ, 163, corporate email, etc.)",
    gmail: "Gmail connector (requires OAuth setup)",
    outlook: "Outlook connector (requires OAuth setup)",
  };
  return descriptions[provider] ?? "Unknown provider";
}
