/**
 * Research 工具：联网验证与背景调查。
 *
 * §2.9 + §2.11.4：研究型分析在 Phase 3 落地。当前是 schema-defined stub，
 * 让主循环能注册并让 LLM"知道这些工具存在"，但真正调用时返回 not_implemented，
 * 防止 LLM 在 Phase 3 之前误以为联网做了核实。
 *
 * 风险等级故意标 high：web_search 默认 ≤ 3 / 任务、verify_domain ≤ 5；
 * 同时所有高风险动作必须经 DecisionPolicy 在 beforeToolCall 阻断。
 */

import type { AnyToolDefinition } from "./base.js";

export interface WebSearchArgs {
  query: string;
  /** 最多返回 N 条结果，默认 5，硬上限 10。 */
  topK?: number;
}

export interface WebSearchResult {
  results: { title: string; url: string; snippet: string }[];
  note?: string;
}

export interface VerifyDomainArgs {
  domain: string;
}

export interface DomainVerificationResult {
  domain: string;
  riskLevel: "low" | "medium" | "high" | "unknown";
  reasons: string[];
  note?: string;
}

export function createResearchTools(): AnyToolDefinition[] {
  return [
    {
      name: "web_search",
      description:
        "Search the web for background on an entity, claim, or suspicious link. HIGH RISK and rate-limited; only use when domain reputation, sender authenticity, or external facts directly affect a planned action.",
      schema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1 },
          topK: { type: "number", minimum: 1, maximum: 10 },
        },
        additionalProperties: false,
      },
      risk: "high",
      rateLimit: { perTask: 3 },
      async invoke(args: WebSearchArgs): Promise<WebSearchResult> {
        return {
          results: [],
          note: `web_search backend not yet implemented (Phase 3). Query was: "${args.query.slice(0, 80)}"`,
        };
      },
    },
    {
      name: "verify_domain",
      description:
        "Check a domain's reputation against known-good lists and lookalike patterns before approving an action triggered by a suspicious link.",
      schema: {
        type: "object",
        required: ["domain"],
        properties: {
          domain: { type: "string", minLength: 3 },
        },
        additionalProperties: false,
      },
      risk: "medium",
      rateLimit: { perTask: 5 },
      async invoke(args: VerifyDomainArgs): Promise<DomainVerificationResult> {
        const domain = normalizeDomain(args.domain);
        const reasons: string[] = [];
        const labels = domain.split(".");
        const tld = labels.at(-1) ?? "";
        const sld = labels.at(-2) ?? labels[0] ?? domain;
        const suspiciousWords = ["login", "verify", "security", "account", "password", "billing", "support", "wallet"];
        const trustedDomains = new Set(["github.com", "google.com", "microsoft.com", "apple.com", "notion.so", "netflix.com"]);

        if (trustedDomains.has(domain)) reasons.push("Domain is in the built-in trusted demo allowlist.");
        if (["test", "invalid", "example"].includes(tld)) reasons.push(`Reserved or non-production TLD: .${tld}.`);
        if (suspiciousWords.some((word) => sld.includes(word))) reasons.push("Domain label contains account-security bait words.");
        if (sld.includes("-")) reasons.push("Domain label uses hyphenated brand/login style.");
        if (/\d/.test(sld)) reasons.push("Domain label contains digits, a common lookalike signal.");

        const riskLevel = trustedDomains.has(domain)
          ? "low"
          : reasons.length >= 2
            ? "high"
            : reasons.length === 1
              ? "medium"
              : "unknown";
        return {
          domain,
          riskLevel,
          reasons,
          note: "Offline heuristic check only; no live reputation lookup was performed.",
        };
      },
    },
  ];
}

function normalizeDomain(raw: string): string {
  const withProtocol = raw.includes("://") ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return raw.toLowerCase().replace(/^www\./, "");
  }
}
