import { describe, it, expect, beforeEach } from "vitest";
import { RiskEvaluator } from "../src/research/risk.js";
import type { EmailMessage, EmailJudgment } from "../src/data/models.js";

describe("RiskEvaluator", () => {
  let evaluator: RiskEvaluator;

  beforeEach(() => {
    evaluator = new RiskEvaluator();
  });

  const createTestMessage = (overrides: Partial<EmailMessage> = {}): EmailMessage => ({
    id: "test-1",
    sender: overrides.sender ?? "test@example.com",
    subject: overrides.subject ?? "Test Subject",
    snippet: overrides.snippet ?? "Test snippet",
    body: overrides.body ?? "Test body content",
    date: new Date().toISOString(),
    hasAttachment: overrides.hasAttachment ?? false,
    unread: overrides.unread ?? false,
    labels: overrides.labels ?? [],
  });

  it("evaluates low risk for normal email", () => {
    const message = createTestMessage({
      sender: "noreply@github.com",
      subject: "You have a new notification",
      body: "This is a normal notification email.",
    });

    const evaluation = evaluator.evaluate(message);

    expect(evaluation.overallRisk).toBe("low");
    expect(evaluation.requiresInvestigation).toBe(false);
    expect(evaluation.suggestedInvestigations).toHaveLength(0);
  });

  it("detects high risk from suspicious keywords", () => {
    const message = createTestMessage({
      sender: "support@security-alert.com",
      subject: "URGENT: Your account will be suspended",
      body: "Please verify your password immediately to avoid account suspension.",
    });

    const evaluation = evaluator.evaluate(message);

    expect(evaluation.overallRisk).toBe("high");
    expect(evaluation.requiresInvestigation).toBe(true);
    expect(evaluation.suggestedInvestigations).toContain("web_search");
  });

  it("detects medium risk from attachments", () => {
    const message = createTestMessage({
      sender: "invoices@company.com",
      subject: "Invoice attached",
      body: "Please find the invoice attached.",
      hasAttachment: true,
    });

    const evaluation = evaluator.evaluate(message);

    expect(evaluation.overallRisk).toBe("medium");
    expect(evaluation.requiresInvestigation).toBe(true);
  });

  it("detects high risk from IP address links", () => {
    const message = createTestMessage({
      sender: "admin@company.com",
      subject: "Login required",
      body: "Please login at https://192.168.1.1/login to verify your account.",
    });

    const evaluation = evaluator.evaluate(message);

    expect(evaluation.overallRisk).toBe("high");
    expect(evaluation.suggestedInvestigations).toContain("verify_domain");
  });

  it("evaluates judgment with spam category", () => {
    const message = createTestMessage({
      sender: "spam@badsite.com",
      subject: "You won a prize",
      body: "Click here to claim your prize!",
    });

    const judgment: EmailJudgment = {
      emailId: "test-1",
      category: "spam",
      confidence: 0.9,
      urgency: 3,
      reason: "Detected as spam",
      actionSuggestion: "archive",
    };

    const evaluation = evaluator.evaluateJudgment(judgment, message);

    expect(evaluation.overallRisk).toBe("high");
    expect(evaluation.factors.contentRisk).toBe("high");
  });

  it("adjusts confidence based on judgment confidence", () => {
    const message = createTestMessage();
    const judgment: EmailJudgment = {
      emailId: "test-1",
      category: "important",
      confidence: 0.5,
      urgency: 3,
      reason: "Uncertain classification",
      actionSuggestion: "report_only",
    };

    const evaluation = evaluator.evaluateJudgment(judgment, message);

    expect(evaluation.confidence).toBeLessThan(0.7);
    expect(evaluation.suggestedInvestigations).toContain("Low confidence classification");
  });

  it("provides reasons for risk factors", () => {
    const message = createTestMessage({
      sender: "support12345@security.com",
      subject: "URGENT: Verify your account",
      body: "Please login immediately at https://bit.ly/verify",
    });

    const evaluation = evaluator.evaluate(message);

    expect(evaluation.factors.reasons.length).toBeGreaterThan(0);
    expect(evaluation.factors.reasons.some((r) => r.includes("Suspicious keyword"))).toBe(true);
  });

  it("supports custom suspicious keywords", () => {
    const customEvaluator = new RiskEvaluator({
      suspiciousKeywords: ["custom", "alert"],
    });

    const message = createTestMessage({
      subject: "Custom alert message",
      body: "This is a custom alert.",
    });

    const evaluation = customEvaluator.evaluate(message);

    expect(evaluation.overallRisk).toBe("medium");
  });

  it("supports trusted senders", () => {
    const trustedEvaluator = new RiskEvaluator({
      trustedSenders: ["trusted@example.com"],
    });

    const message = createTestMessage({
      sender: "trusted@example.com",
      subject: "Urgent action required",
      body: "Please verify your account immediately.",
    });

    const evaluation = trustedEvaluator.evaluate(message);

    expect(evaluation.factors.senderRisk).toBe("low");
  });
});