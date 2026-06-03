/**
 * 钓鱼检测：识别钓鱼邮件模式。
 *
 * Phase 3.3 实现：
 *   - PhishingDetector 识别钓鱼邮件
 *   - 基于模式匹配和行为分析
 *   - 支持自定义钓鱼规则
 */

import type { EmailMessage } from "../data/models.js";

export interface PhishingPattern {
  id: string;
  name: string;
  description: string;
  severity: "low" | "medium" | "high";
  check: (message: EmailMessage) => boolean;
}

export interface PhishingDetection {
  isPhishing: boolean;
  confidence: number;
  matchedPatterns: Array<{
    pattern: string;
    severity: string;
    description: string;
  }>;
  reasons: string[];
}

export class PhishingDetector {
  private patterns: PhishingPattern[] = [];

  constructor() {
    this.initializePatterns();
  }

  private initializePatterns(): void {
    this.patterns = [
      {
        id: "urgent_action",
        name: "Urgent Action Required",
        description: "Email demands immediate action or threatens consequences",
        severity: "high",
        check: (m) => {
          const text = `${m.subject} ${m.snippet} ${m.body ?? ""}`.toLowerCase();
          return (
            text.includes("urgent") ||
            text.includes("immediately") ||
            text.includes("expire") ||
            text.includes("suspended") ||
            text.includes("within 24 hours") ||
            text.includes("act now")
          );
        },
      },
      {
        id: "credential_harvesting",
        name: "Credential Harvesting",
        description: "Email asks for sensitive information or credentials",
        severity: "high",
        check: (m) => {
          const text = `${m.subject} ${m.snippet} ${m.body ?? ""}`.toLowerCase();
          return (
            text.includes("password") ||
            text.includes("username") ||
            text.includes("login") ||
            text.includes("verify your account") ||
            text.includes("confirm your identity") ||
            text.includes("update your information")
          );
        },
      },
      {
        id: "suspicious_link",
        name: "Suspicious Link",
        description: "Email contains suspicious or mismatched links",
        severity: "medium",
        check: (m) => {
          const body = m.body ?? "";
          const linkPattern = /https?:\/\/[^\s]+/g;
          const links = body.match(linkPattern) ?? [];

          for (const link of links) {
            try {
              const url = new URL(link);
              const domain = url.hostname.toLowerCase();

              // Check for IP address
              if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) {
                return true;
              }

              // Check for URL shortener
              if (["bit.ly", "tinyurl.com", "goo.gl", "t.co"].includes(domain)) {
                return true;
              }

              // Check for suspicious TLD
              const tld = domain.split(".").pop();
              if (tld && ["xyz", "top", "tk", "ml", "ga", "cf"].includes(tld)) {
                return true;
              }
            } catch {
              // Invalid URL
            }
          }

          return false;
        },
      },
      {
        id: "sender_mismatch",
        name: "Sender Mismatch",
        description: "Sender domain does not match organization domain",
        severity: "medium",
        check: (m) => {
          const senderDomain = m.sender.split("@")[1]?.toLowerCase() ?? "";
          const text = `${m.subject} ${m.snippet} ${m.body ?? ""}`.toLowerCase();

          // Extract domains from email content
          const domainPattern = /@([a-z0-9.-]+\.[a-z]{2,})/gi;
          const matches = text.match(domainPattern) ?? [];
          const contentDomains = matches.map((m) => m.slice(1).toLowerCase());

          // Check if content mentions a domain different from sender
          for (const domain of contentDomains) {
            if (domain !== senderDomain && domain.length > 5) {
              return true;
            }
          }

          return false;
        },
      },
      {
        id: "generic_greeting",
        name: "Generic Greeting",
        description: "Email uses generic greeting instead of personalized",
        severity: "low",
        check: (m) => {
          const body = m.body ?? "";
          const genericGreetings = [
            "dear customer",
            "dear valued customer",
            "dear user",
            "dear account holder",
            "dear sir/madam",
            "greetings",
          ];

          const lowerBody = body.toLowerCase();
          return genericGreetings.some((g) => lowerBody.includes(g));
        },
      },
      {
        id: "poor_grammar",
        name: "Poor Grammar",
        description: "Email contains grammatical errors or awkward phrasing",
        severity: "low",
        check: (m) => {
          const text = `${m.subject} ${m.snippet} ${m.body ?? ""}`;

          // Simple heuristics for poor grammar
          const patterns = [
            /\b(we are|you are|they are) (been|have)\b/gi,
            /\bplease kindly\b/gi,
            /\bkindly\b/gi,
            /\bwe want to inform you that\b/gi,
            /\byour account has been (compromised|suspended|limited)\b/gi,
          ];

          let matchCount = 0;
          for (const pattern of patterns) {
            if (pattern.test(text)) {
              matchCount++;
            }
          }

          return matchCount >= 2;
        },
      },
      {
        id: "attachment_executable",
        name: "Executable Attachment",
        description: "Email contains executable or suspicious file attachment",
        severity: "high",
        check: (m) => {
          if (!m.hasAttachment) return false;

          const body = m.body ?? "";
          const attachmentPattern = /\.(exe|zip|rar|7z|scr|bat|cmd|vbs|js|jar|msi)$/gi;
          return attachmentPattern.test(body);
        },
      },
      {
        id: "financial_request",
        name: "Financial Request",
        description: "Email requests payment or financial information",
        severity: "high",
        check: (m) => {
          const text = `${m.subject} ${m.snippet} ${m.body ?? ""}`.toLowerCase();
          return (
            text.includes("payment") ||
            text.includes("invoice") ||
            text.includes("wire transfer") ||
            text.includes("bank account") ||
            text.includes("credit card") ||
            text.includes("purchase") ||
            text.includes("billing")
          );
        },
      },
    ];
  }

  detect(message: EmailMessage): PhishingDetection {
    const matchedPatterns: PhishingDetection["matchedPatterns"] = [];
    const reasons: string[] = [];

    for (const pattern of this.patterns) {
      if (pattern.check(message)) {
        matchedPatterns.push({
          pattern: pattern.id,
          severity: pattern.severity,
          description: pattern.description,
        });
        reasons.push(`[${pattern.severity.toUpperCase()}] ${pattern.description}`);
      }
    }

    const isPhishing = matchedPatterns.length > 0;
    const confidence = this.calculateConfidence(matchedPatterns);

    return {
      isPhishing,
      confidence,
      matchedPatterns,
      reasons,
    };
  }

  private calculateConfidence(matchedPatterns: PhishingDetection["matchedPatterns"]): number {
    if (matchedPatterns.length === 0) {
      return 0;
    }

    const highSeverityCount = matchedPatterns.filter((p) => p.severity === "high").length;
    const mediumSeverityCount = matchedPatterns.filter((p) => p.severity === "medium").length;
    const lowSeverityCount = matchedPatterns.filter((p) => p.severity === "low").length;

    // Weighted confidence calculation
    let confidence = 0;
    confidence += highSeverityCount * 0.3;
    confidence += mediumSeverityCount * 0.15;
    confidence += lowSeverityCount * 0.05;

    return Math.min(confidence, 1.0);
  }

  addPattern(pattern: PhishingPattern): void {
    this.patterns.push(pattern);
  }

  removePattern(id: string): boolean {
    const index = this.patterns.findIndex((p) => p.id === id);
    if (index === -1) return false;

    this.patterns.splice(index, 1);
    return true;
  }

  getPatterns(): PhishingPattern[] {
    return [...this.patterns];
  }
}