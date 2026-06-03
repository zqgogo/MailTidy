/**
 * 风险评级：评估邮件和动作的风险等级。
 *
 * Phase 3.3 实现：
 *   - RiskEvaluator 评估邮件风险
 *   - 基于发件人、内容、链接等多维度分析
 *   - 支持自定义风险规则
 */

import type { EmailMessage, EmailJudgment } from "../data/models.js";
import { ActionRisk } from "../data/models.js";

export interface RiskFactors {
  senderRisk: "low" | "medium" | "high";
  contentRisk: "low" | "medium" | "high";
  linkRisk: "low" | "medium" | "high";
  attachmentRisk: "low" | "medium" | "high";
  reasons: string[];
}

export interface RiskEvaluation {
  overallRisk: ActionRisk;
  factors: RiskFactors;
  confidence: number;
  requiresInvestigation: boolean;
  suggestedInvestigations: string[];
}

export class RiskEvaluator {
  private readonly suspiciousKeywords: string[];
  private readonly suspiciousDomains: Set<string>;
  private readonly trustedSenders: Set<string>;

  constructor(options: {
    suspiciousKeywords?: string[];
    suspiciousDomains?: string[];
    trustedSenders?: string[];
  } = {}) {
    this.suspiciousKeywords = options.suspiciousKeywords ?? [
      "urgent", "verify", "confirm", "suspended", "account",
      "password", "security", "billing", "payment", "wallet",
      "login", "click here", "immediately", "expire",
    ];
    this.suspiciousDomains = new Set(options.suspiciousDomains ?? []);
    this.trustedSenders = new Set(options.trustedSenders ?? []);
  }

  evaluate(message: EmailMessage): RiskEvaluation {
    const factors = this.analyzeRiskFactors(message);
    const overallRisk = this.calculateOverallRisk(factors);
    const confidence = this.calculateConfidence(factors);
    const requiresInvestigation = overallRisk !== ActionRisk.LOW;
    const suggestedInvestigations = this.suggestInvestigations(factors, message);

    return {
      overallRisk,
      factors,
      confidence,
      requiresInvestigation,
      suggestedInvestigations,
    };
  }

  evaluateJudgment(judgment: EmailJudgment, message: EmailMessage): RiskEvaluation {
    const baseEvaluation = this.evaluate(message);

    // 根据判断调整风险
    if (judgment.category === "spam") {
      baseEvaluation.factors.contentRisk = "high";
      baseEvaluation.factors.reasons.push("Judged as spam");
    } else if (judgment.category === "important" || judgment.category === "actionable") {
      baseEvaluation.factors.contentRisk = "low";
    }

    if (judgment.confidence < 0.7) {
      baseEvaluation.confidence = Math.min(baseEvaluation.confidence, 0.6);
      baseEvaluation.suggestedInvestigations.push("Low confidence classification");
    }

    return {
      ...baseEvaluation,
      overallRisk: this.calculateOverallRisk(baseEvaluation.factors),
    };
  }

  private analyzeRiskFactors(message: EmailMessage): RiskFactors {
    const reasons: string[] = [];

    // 发件人风险
    const senderRisk = this.evaluateSenderRisk(message.sender, reasons);

    // 内容风险
    const contentRisk = this.evaluateContentRisk(message, reasons);

    // 链接风险（从 body 中提取）
    const linkRisk = this.evaluateLinkRisk(message.body ?? "", reasons);

    // 附件风险
    const attachmentRisk = this.evaluateAttachmentRisk(message, reasons);

    return {
      senderRisk,
      contentRisk,
      linkRisk,
      attachmentRisk,
      reasons,
    };
  }

  private evaluateSenderRisk(sender: string, reasons: string[]): "low" | "medium" | "high" {
    const domain = sender.split("@")[1]?.toLowerCase() ?? "";

    if (this.trustedSenders.has(sender)) {
      return "low";
    }

    if (this.suspiciousDomains.has(domain)) {
      reasons.push(`Sender domain ${domain} is in suspicious list`);
      return "high";
    }

    // 检查免费邮箱服务
    const freeEmailProviders = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"];
    if (freeEmailProviders.includes(domain)) {
      return "low";
    }

    // 检查可疑的发件人模式
    if (/\d{4,}/.test(sender)) {
      reasons.push("Sender contains multiple digits (possible random address)");
      return "medium";
    }

    if (sender.includes("noreply") || sender.includes("no-reply")) {
      return "low";
    }

    return "low";
  }

  private evaluateContentRisk(message: EmailMessage, reasons: string[]): "low" | "medium" | "high" {
    const text = `${message.subject} ${message.snippet} ${message.body ?? ""}`.toLowerCase();
    let riskLevel: "low" | "medium" | "high" = "low";
    let suspiciousCount = 0;

    for (const keyword of this.suspiciousKeywords) {
      if (text.includes(keyword)) {
        suspiciousCount++;
        reasons.push(`Suspicious keyword: "${keyword}"`);
      }
    }

    if (suspiciousCount >= 3) {
      riskLevel = "high";
    } else if (suspiciousCount >= 1) {
      riskLevel = "medium";
    }

    // 检查紧急程度
    if (text.includes("urgent") || text.includes("immediately") || text.includes("expire")) {
      reasons.push("Urgency language detected (common in phishing)");
      riskLevel = riskLevel === "high" ? "high" : "medium";
    }

    return riskLevel;
  }

  private evaluateLinkRisk(body: string, reasons: string[]): "low" | "medium" | "high" {
    const linkPattern = /https?:\/\/[^\s]+/g;
    const links = body.match(linkPattern) ?? [];

    if (links.length === 0) {
      return "low";
    }

    let suspiciousCount = 0;

    for (const link of links) {
      try {
        const url = new URL(link);
        const domain = url.hostname.toLowerCase();

        // 检查 IP 地址
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) {
          reasons.push(`Link uses IP address: ${domain}`);
          suspiciousCount++;
        }

        // 检查可疑域名
        if (this.suspiciousDomains.has(domain)) {
          reasons.push(`Link to suspicious domain: ${domain}`);
          suspiciousCount++;
        }

        // 检查短链接
        if (["bit.ly", "tinyurl.com", "goo.gl", "t.co"].includes(domain)) {
          reasons.push(`Link uses URL shortener: ${domain}`);
          suspiciousCount++;
        }

        // 检查可疑路径
        if (url.pathname.includes("login") || url.pathname.includes("verify") || url.pathname.includes("account")) {
          reasons.push(`Link path suggests credential harvesting: ${url.pathname}`);
          suspiciousCount++;
        }
      } catch {
        // Invalid URL, skip
      }
    }

    if (suspiciousCount >= 2) {
      return "high";
    } else if (suspiciousCount >= 1) {
      return "medium";
    }

    return "low";
  }

  private evaluateAttachmentRisk(message: EmailMessage, reasons: string[]): "low" | "medium" | "high" {
    if (!message.hasAttachment) {
      return "low";
    }

    // 没有附件详细信息，只能基于存在性判断
    reasons.push("Email contains attachments");
    return "medium";
  }

  private calculateOverallRisk(factors: RiskFactors): ActionRisk {
    const risks = [factors.senderRisk, factors.contentRisk, factors.linkRisk, factors.attachmentRisk];

    if (risks.some((r) => r === "high")) {
      return ActionRisk.HIGH;
    }

    if (risks.filter((r) => r === "medium").length >= 2) {
      return ActionRisk.HIGH;
    }

    if (risks.some((r) => r === "medium")) {
      return ActionRisk.MEDIUM;
    }

    return ActionRisk.LOW;
  }

  private calculateConfidence(factors: RiskFactors): number {
    // 风险越高，置信度越高（因为风险因素更明确）
    const highRiskCount = Object.values(factors).filter((v) => v === "high").length;
    const mediumRiskCount = Object.values(factors).filter((v) => v === "medium").length;

    if (highRiskCount >= 2) {
      return 0.9;
    } else if (highRiskCount >= 1) {
      return 0.8;
    } else if (mediumRiskCount >= 2) {
      return 0.7;
    } else if (mediumRiskCount >= 1) {
      return 0.6;
    }

    return 0.5;
  }

  private suggestInvestigations(factors: RiskFactors, message: EmailMessage): string[] {
    const suggestions: string[] = [];

    if (factors.senderRisk === "high") {
      suggestions.push("verify_sender");
    }

    if (factors.linkRisk === "high" || factors.linkRisk === "medium") {
      suggestions.push("verify_domain");
    }

    if (factors.contentRisk === "high") {
      suggestions.push("web_search");
    }

    return suggestions;
  }
}