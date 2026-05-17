/**
 * Demo 冒烟测试：保证迁移后端到端流水线仍能跑出 cleanup report，
 * 单测档位等价于原 Python `tests/test_agent.py`。
 */

import { describe, expect, it } from "vitest";
import { LegacyMailTidyAgent } from "../src/agent/legacy.js";
import { MockEmailConnector } from "../src/integrations/email/mock.js";
import { HeuristicLLMClient } from "../src/integrations/llm/heuristic.js";

describe("LegacyMailTidyAgent end-to-end demo", () => {
  it("produces a cleanup report and exercises connector writes", async () => {
    const connector = new MockEmailConnector();
    const agent = new LegacyMailTidyAgent({ connector, llm: new HeuristicLLMClient() });

    const report = await agent.runCleanup({ autoConfirm: true });

    expect(report).toContain("# MailTidy Cleanup Report");
    expect(report).toContain("Needs Your Attention");
    // 启发式分类应至少跟某些 connector 写动作（label / star / archive 之一）。
    expect(connector.operations.length).toBeGreaterThan(0);
  });

  it("creates drafts for actionable emails", async () => {
    const connector = new MockEmailConnector();
    const agent = new LegacyMailTidyAgent({ connector, llm: new HeuristicLLMClient() });
    const result = await agent.draftReplies();
    expect(result.draftsCreated).toBeGreaterThanOrEqual(1);
    expect(connector.operations.some((op) => op.startsWith("draft:"))).toBe(true);
  });

  it("scans subscriptions and returns markdown + csv", async () => {
    const connector = new MockEmailConnector();
    const agent = new LegacyMailTidyAgent({ connector, llm: new HeuristicLLMClient() });
    const { markdown, csv } = await agent.scanSubscriptions();
    expect(markdown).toContain("# Subscription Scan");
    expect(csv.split("\n")[0]).toContain("service_name");
  });
});
