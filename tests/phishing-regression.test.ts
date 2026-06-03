/**
 * 防钓鱼专项回归测试
 *
 * Phase 3.5 实现：
 *   - FTX 类邮件测试
 *   - 伪造域名测试
 *   - 伪造账户验证测试
 *   - 紧急行动测试
 *   - 凭证窃取测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PhishingDetector } from "../src/research/phishing.js";
import { RiskEvaluator } from "../src/research/risk.js";
import type { EmailMessage } from "../src/data/models.js";

describe("Phishing Regression Tests", () => {
  let detector: PhishingDetector;
  let evaluator: RiskEvaluator;

  beforeEach(() => {
    detector = new PhishingDetector();
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

  describe("FTX-Style Phishing Tests", () => {
    it("detects FTX-style cryptocurrency exchange phishing", () => {
      const message = createTestMessage({
        sender: "support@ftx-crypto.com",
        subject: "URGENT: Your FTX account has been compromised",
        body: `Dear User,

We have detected suspicious activity on your FTX account. Your account will be suspended within 24 hours unless you verify your identity immediately.

Please click here to verify your account: https://ftx-secure-login.com/verify

If you do not take action, your assets will be frozen.

Best regards,
FTX Security Team`,
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(detection.confidence).toBeGreaterThan(0.6);
      expect(evaluation.overallRisk).toBe("high");
      expect(evaluation.requiresInvestigation).toBe(true);
    });

    it("detects fake crypto exchange with urgency", () => {
      const message = createTestMessage({
        sender: "alerts@binance-security.net",
        subject: "SECURITY ALERT: Unusual login detected",
        body: `We noticed a login from a new device. Please verify this was you.

Login details:
- IP: 192.168.1.1
- Location: Unknown
- Time: ${new Date().toISOString()}

If this was not you, please click here to secure your account immediately: https://binance-verify.net/secure

Your account will be suspended in 2 hours if no action is taken.`,
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(detection.matchedPatterns.some((p) => p.pattern === "urgent_action")).toBe(true);
      expect(evaluation.overallRisk).toBe("high");
    });

    it("detects crypto withdrawal scam", () => {
      const message = createTestMessage({
        sender: "withdrawals@crypto-exchange.com",
        subject: "Withdrawal Request Pending",
        body: `Your withdrawal request is pending approval.

Amount: 2.5 BTC
Destination: Unknown wallet

To approve this withdrawal, please click here: https://crypto-exchange-approve.com/withdraw

If you did not request this withdrawal, please contact support immediately.`,
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(evaluation.overallRisk).toBe("high");
    });
  });

  describe("Fake Domain Tests", () => {
    it("detects typosquatting domain", () => {
      const message = createTestMessage({
        sender: "support@g00gle.com",
        subject: "Your Google account security alert",
        body: "Please verify your Google account immediately to avoid suspension.",
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(evaluation.overallRisk).toBe("high");
    });

    it("detects subdomain abuse", () => {
      const message = createTestMessage({
        sender: "security@verify-login.com",
        subject: "Google Account Verification",
        body: "Please verify your Google account by clicking here: https://google-verify.net/login",
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(evaluation.overallRisk).toBe("high");
    });

    it("detects lookalike domain with special characters", () => {
      const message = createTestMessage({
        sender: "support@paypa1-security.com",
        subject: "PayPal Account Limited - URGENT",
        body: "Your PayPal account has been limited due to suspicious activity. Please click here to verify: https://paypa1.com/verify?email=user@example.com",
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(evaluation.overallRisk).toBe("high");
    });
  });

  describe("Fake Account Verification Tests", () => {
    it("detects fake Microsoft account verification", () => {
      const message = createTestMessage({
        sender: "account-security@microsoft-verify.com",
        subject: "Microsoft Account Verification Required",
        body: `Dear Customer,

Your Microsoft account requires verification to continue using our services.

Please verify your account by clicking here: https://microsoft-verify.net/account

If you do not verify your account within 24 hours, it will be suspended.

Microsoft Security Team`,
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(detection.matchedPatterns.some((p) => p.pattern === "credential_harvesting")).toBe(true);
      expect(evaluation.overallRisk).toBe("high");
    });

    it("detects fake Apple ID verification", () => {
      const message = createTestMessage({
        sender: "appleid@apple-security-alert.com",
        subject: "Your Apple ID was used to sign in to iCloud",
        body: `Your Apple ID was used to sign in to iCloud via a web browser.

If you recently signed in, you can safely ignore this email.

If you did not sign in, please change your password immediately: https://apple-verify.net/id

Apple Support`,
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(evaluation.overallRisk).toBe("high");
    });

    it("detects fake Amazon account verification", () => {
      const message = createTestMessage({
        sender: "account-update@amazon-secure.com",
        subject: "Update your Amazon account information",
        body: `We need to verify your account information.

Please update your account details by clicking here: https://amazon-verify.net/account

Your account will be suspended if you do not update your information.

Amazon Customer Service`,
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(evaluation.overallRisk).toBe("high");
    });
  });

  describe("Urgent Action Tests", () => {
    it("detects immediate action requirement", () => {
      const message = createTestMessage({
        sender: "alerts@security-system.com",
        subject: "IMMEDIATE ACTION REQUIRED",
        body: "Your account will be deleted in 1 hour. Please act immediately to save your data.",
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(detection.matchedPatterns.some((p) => p.pattern === "urgent_action")).toBe(true);
      expect(evaluation.overallRisk).toBe("medium");
    });

    it("detects 24-hour ultimatum", () => {
      const message = createTestMessage({
        sender: "support@online-service.com",
        subject: "Account suspension in 24 hours",
        body: "Your account will be suspended within 24 hours unless you verify your identity.",
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(evaluation.overallRisk).toBe("high");
    });

    it("detects limited time offer with urgency", () => {
      const message = createTestMessage({
        sender: "promotions@limited-offer.com",
        subject: "EXPIRES IN 2 HOURS: 90% OFF",
        body: "This offer expires in 2 hours. Click here to claim your discount now: https://limited-offer.com/claim",
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(evaluation.overallRisk).toBe("medium");
    });
  });

  describe("Credential Harvesting Tests", () => {
    it("detects password reset request", () => {
      const message = createTestMessage({
        sender: "password-reset@service.com",
        subject: "Reset your password",
        body: "Please click here to reset your password: https://service-reset.com/password",
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(detection.matchedPatterns.some((p) => p.pattern === "credential_harvesting")).toBe(true);
      expect(evaluation.overallRisk).toBe("medium");
    });

    it("detects 2FA bypass attempt", () => {
      const message = createTestMessage({
        sender: "security@auth-system.com",
        subject: "Verify your identity",
        body: "Please enter your verification code to confirm your identity: https://auth-system.com/verify",
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(evaluation.overallRisk).toBe("high");
    });

    it("detects social security number request", () => {
      const message = createTestMessage({
        sender: "verification@tax-service.com",
        subject: "Verify your tax information",
        body: "Please provide your social security number to verify your account.",
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(evaluation.overallRisk).toBe("high");
    });
  });

  describe("Combined Attack Patterns", () => {
    it("detects multi-pattern phishing attack", () => {
      const message = createTestMessage({
        sender: "security@bank-verify.com",
        subject: "URGENT: Your account has been compromised",
        body: `Dear Customer,

We detected unauthorized access to your account. Your account will be suspended within 24 hours.

Please verify your identity immediately: https://bank-verify.net/login

If you do not act, your funds will be frozen.

Bank Security Team`,
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(detection.matchedPatterns.length).toBeGreaterThan(2);
      expect(detection.confidence).toBeGreaterThan(0.6);
      expect(evaluation.overallRisk).toBe("high");
      expect(evaluation.requiresInvestigation).toBe(true);
    });

    it("detects phishing with attachment", () => {
      const message = createTestMessage({
        sender: "invoices@company.com",
        subject: "URGENT: Invoice attached",
        body: "Please review the attached invoice and make payment immediately.",
        hasAttachment: true,
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(evaluation.overallRisk).toBe("high");
      expect(evaluation.suggestedInvestigations).toContain("web_search");
    });

    it("detects phishing with IP address link", () => {
      const message = createTestMessage({
        sender: "admin@company.com",
        subject: "Login required",
        body: "Please login at https://192.168.1.1/login to verify your account.",
      });

      const detection = detector.detect(message);
      const evaluation = evaluator.evaluate(message);

      expect(detection.isPhishing).toBe(true);
      expect(detection.matchedPatterns.some((p) => p.pattern === "suspicious_link")).toBe(true);
      expect(evaluation.overallRisk).toBe("high");
    });
  });

  describe("False Negative Prevention", () => {
    it("detects phishing with generic greeting", () => {
      const message = createTestMessage({
        sender: "support@company.com",
        subject: "Account update required",
        body: "Dear valued customer, please update your account information immediately.",
      });

      const detection = detector.detect(message);

      expect(detection.isPhishing).toBe(true);
      expect(detection.matchedPatterns.some((p) => p.pattern === "generic_greeting")).toBe(true);
    });

    it("detects phishing with poor grammar", () => {
      const message = createTestMessage({
        sender: "support@company.com",
        subject: "Account update",
        body: "We want to inform you that your account has been compromised. Please kindly update your information.",
      });

      const detection = detector.detect(message);

      expect(detection.isPhishing).toBe(true);
      expect(detection.matchedPatterns.some((p) => p.pattern === "poor_grammar")).toBe(true);
    });

    it("detects phishing with sender mismatch", () => {
      const message = createTestMessage({
        sender: "support@othercompany.com",
        subject: "Your account at company.com",
        body: "Please contact support@company.com for assistance.",
      });

      const detection = detector.detect(message);

      expect(detection.isPhishing).toBe(true);
      expect(detection.matchedPatterns.some((p) => p.pattern === "sender_mismatch")).toBe(true);
    });
  });
});