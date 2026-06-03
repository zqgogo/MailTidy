/**
 * Research 工具：联网验证与背景调查。
 *
 * Phase 3.3 实现：
 *   - web_search 使用 WebSearch 工具进行真实联网搜索
 *   - verify_domain 保持启发式检查
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
        try {
          // WebSearch 工具会由外部环境提供
          const webSearch = (globalThis as { WebSearch?: (args: { query: string; num: number }) => Promise<Array<{ title: string; url: string; snippet?: string }>> }).WebSearch;
          
          if (!webSearch) {
            return {
              results: [],
              note: "web_search backend not available. Query was: " + args.query.slice(0, 80),
            };
          }

          const topK = Math.min(args.topK ?? 5, 10);
          const searchResults = await webSearch({ query: args.query, num: topK });

          const results = searchResults.map((r: { title: string; url: string; snippet?: string }) => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet ?? "",
          }));

          return { results };
        } catch (error) {
          return {
            results: [],
            note: `web_search error: ${error instanceof Error ? error.message : "Unknown error"}`,
          };
        }
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