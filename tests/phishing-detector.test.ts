import { describe, it, expect, beforeEach } from "vitest";
import { PhishingDetector } from "../src/research/phishing.js";
import type { EmailMessage } from "../src/data/models.js";

describe("PhishingDetector", () => {
  let detector: PhishingDetector;

  beforeEach(() => {
    detector = new PhishingDetector();
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

  it("detects no phishing in normal email", () => {
    const message = createTestMessage({
      sender: "noreply@github.com",
      subject: "You have a new notification",
      body: "This is a normal notification email from GitHub.",
    });

    const detection = detector.detect(message);

    expect(detection.isPhishing).toBe(false);
    expect(detection.confidence).toBe(0);
    expect(detection.matchedPatterns).toHaveLength(0);
  });

  it("detects urgent action phishing", () => {
    const message = createTestMessage({
      sender: "support@security.com",
      subject: "URGENT: Your account will be suspended",
      body: "Please act immediately to avoid account suspension within 24 hours.",
    });

    const detection = detector.detect(message);

    expect(detection.isPhishing).toBe(true);
    expect(detection.confidence).toBeGreaterThan(0);
    expect(detection.matchedPatterns.some((p) => p.pattern === "urgent_action")).toBe(true);
  });

  it("detects credential harvesting", () => {
    const message = createTestMessage({
      sender: "admin@company.com",
      subject: "Verify your account",
      body: "Please click here to verify your account and confirm your identity.",
    });

    const detection = detector.detect(message);

    expect(detection.isPhishing).toBe(true);
    expect(detection.matchedPatterns.some((p) => p.pattern === "credential_harvesting")).toBe(true);
  });

  it("detects suspicious IP address links", () => {
    const message = createTestMessage({
      sender: "support@company.com",
      subject: "Login required",
      body: "Please login at https://192.168.1.1/login to verify your account.",
    });

    const detection = detector.detect(message);

    expect(detection.isPhishing).toBe(true);
    expect(detection.matchedPatterns.some((p) => p.pattern === "suspicious_link")).toBe(true);
  });

  it("detects URL shortener links", () => {
    const message = createTestMessage({
      sender: "promo@company.com",
      subject: "Special offer",
      body: "Click here: https://bit.ly/special-offer",
    });

    const detection = detector.detect(message);

    expect(detection.isPhishing).toBe(true);
    expect(detection.matchedPatterns.some((p) => p.pattern === "suspicious_link")).toBe(true);
  });

  it("detects sender mismatch", () => {
    const message = createTestMessage({
      sender: "support@othercompany.com",
      subject: "Your account at company.com",
      body: "Please contact support@company.com for assistance.",
    });

    const detection = detector.detect(message);

    expect(detection.isPhishing).toBe(true);
    expect(detection.matchedPatterns.some((p) => p.pattern === "sender_mismatch")).toBe(true);
  });

  it("detects generic greeting", () => {
    const message = createTestMessage({
      sender: "support@company.com",
      subject: "Account update",
      body: "Dear valued customer, please update your account information.",
    });

    const detection = detector.detect(message);

    expect(detection.isPhishing).toBe(true);
    expect(detection.matchedPatterns.some((p) => p.pattern === "generic_greeting")).toBe(true);
  });

  it("detects poor grammar patterns", () => {
    const message = createTestMessage({
      sender: "support@company.com",
      subject: "Account update",
      body: "We want to inform you that your account has been compromised. Please kindly update your information.",
    });

    const detection = detector.detect(message);

    expect(detection.isPhishing).toBe(true);
    expect(detection.matchedPatterns.some((p) => p.pattern === "poor_grammar")).toBe(true);
  });

  it("detects executable attachments", () => {
    const message = createTestMessage({
      sender: "invoices@company.com",
      subject: "Invoice attached",
      body: "Please find the invoice.exe attached. Also see document.zip and setup.msi",
      hasAttachment: true,
    });

    const detection = detector.detect(message);

    expect(detection.isPhishing).toBe(true);
    expect(detection.matchedPatterns.some((p) => p.pattern === "attachment_executable")).toBe(true);
  });

  it("detects financial requests", () => {
    const message = createTestMessage({
      sender: "billing@company.com",
      subject: "Payment required",
      body: "Please make a wire transfer to the following bank account.",
    });

    const detection = detector.detect(message);

    expect(detection.isPhishing).toBe(true);
    expect(detection.matchedPatterns.some((p) => p.pattern === "financial_request")).toBe(true);
  });

  it("calculates confidence based on severity", () => {
    const message = createTestMessage({
      sender: "support@company.com",
      subject: "URGENT: Verify your password immediately",
      body: "Dear customer, please click here to verify your account and make a payment.",
    });

    const detection = detector.detect(message);

    expect(detection.confidence).toBeGreaterThan(0.5);
  });

  it("provides reasons for detection", () => {
    const message = createTestMessage({
      sender: "support@company.com",
      subject: "URGENT: Account suspended",
      body: "Please verify your account immediately.",
    });

    const detection = detector.detect(message);

    expect(detection.reasons.length).toBeGreaterThan(0);
    expect(detection.reasons.some((r) => r.includes("immediate") || r.includes("suspended"))).toBe(true);
  });

  it("allows adding custom patterns", () => {
    detector.addPattern({
      id: "custom_pattern",
      name: "Custom Pattern",
      description: "A custom phishing pattern",
      severity: "high",
      check: (m) => m.subject.includes("CUSTOM"),
    });

    const message = createTestMessage({
      subject: "CUSTOM phishing attempt",
    });

    const detection = detector.detect(message);

    expect(detection.matchedPatterns.some((p) => p.pattern === "custom_pattern")).toBe(true);
  });

  it("allows removing patterns", () => {
    const removed = detector.removePattern("urgent_action");
    expect(removed).toBe(true);

    const message = createTestMessage({
      subject: "URGENT: Account suspended",
    });

    const detection = detector.detect(message);

    expect(detection.matchedPatterns.some((p) => p.pattern === "urgent_action")).toBe(false);
  });
});