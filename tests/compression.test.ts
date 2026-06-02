import { describe, expect, it } from "vitest";
import { ContextCompressor, createCompressor } from "../src/agent/compression.js";
import { createWorkingContext, WorkingContextManager } from "../src/agent/context.js";
import { Category } from "../src/data/models.js";

describe("ContextCompressor", () => {
  it("returns uncompressed content when below threshold", async () => {
    const compressor = createCompressor();
    const content = "Short content that doesn't need compression";
    
    const result = await compressor.compress([content]);
    
    expect(result.wasCompressed).toBe(false);
    expect(result.compressed.summary).toBe(content);
    expect(result.originalLength).toBe(content.length);
    expect(result.compressedLength).toBe(content.length);
  });

  it("compresses content when above threshold", async () => {
    const compressor = createCompressor({ summaryThreshold: 100, minCompressedLength: 50 });
    const longContent = "This is a very long content that definitely exceeds the threshold. ".repeat(20);
    
    const result = await compressor.compress([longContent]);
    
    expect(result.wasCompressed).toBe(true);
    expect(result.compressedLength).toBeLessThan(result.originalLength);
    expect(result.compressed.summary).toContain("[COMPRESSED SUMMARY");
  });

  it("separates facts and inferences in email thread compression", async () => {
    const compressor = createCompressor();
    const messages = [
      { id: "m1", sender: "test@example.com", subject: "Test", snippet: "Test message", date: "2024-01-01" },
      { id: "m2", sender: "ceo@company.com", subject: "Important", snippet: "Urgent request", date: "2024-01-02" },
    ];
    const judgments = [
      { emailId: "m1", category: Category.NOTIFICATION, confidence: 0.9, reason: "Test", actionSuggestion: "archive" },
      { emailId: "m2", category: Category.IMPORTANT, confidence: 0.85, reason: "CEO email", actionSuggestion: "star" },
    ];
    
    const result = await compressor.compressEmailThread(messages as any, judgments as any);
    
    expect(result.compressed.summary).toContain("[FACT]");
    expect(result.compressed.summary).toContain("[INFERENCE]");
    expect(result.compressed.refs.length).toBeGreaterThan(0);
  });

  it("recompresses existing context with new content", async () => {
    const compressor = createCompressor({ summaryThreshold: 100, minCompressedLength: 50 });
    const existing = {
      summary: "Existing summary content. ".repeat(10),
      refs: [{ kind: "email", id: "m1", digest: "abc123" }],
    };
    const newContent = "New content to add. ".repeat(10);
    
    const result = await compressor.recompress(existing, newContent);
    
    expect(result.wasCompressed).toBe(true);
    expect(result.compressed.refs.length).toBeGreaterThan(1);
    expect(result.compressed.summary).toContain("[COMPRESSED SUMMARY");
  });

  it("prioritizes important content during compression", async () => {
    const compressor = createCompressor({ summaryThreshold: 300, minCompressedLength: 200 });
    const content = [
      "[FACT] email:m1 from normal@example.com 'Regular email notification'",
      "[FACT] email:m2 from ceo@company.com 'Important urgent meeting request'",
      "[INFERENCE] email:m1 classified as newsletter (confidence=0.9)",
      "[INFERENCE] email:m2 classified as important (confidence=0.85)",
    ].join("\n");
    
    const result = await compressor.compress([content]);
    
    expect(result.compressed.summary).toContain("ceo@company.com");
    expect(result.compressed.summary).toContain("Important");
    expect(result.compressed.summary).toContain("urgent");
  });

  it("tracks compression phases", async () => {
    const compressor = createCompressor({ summaryThreshold: 100, minCompressedLength: 50 });
    const longContent = "Long content. ".repeat(30);
    
    const result = await compressor.compress([longContent]);
    
    expect(result.phases.length).toBeGreaterThan(0);
    expect(result.phases[0].phase).toBe("initial_compression");
    expect(result.phases[0].timestamp).toBeTruthy();
  });
});

describe("WorkingContextManager", () => {
  it("initializes with empty context", () => {
    const manager = createWorkingContext();
    const context = manager.getContext();
    
    expect(context.summary).toBe("");
    expect(context.refs).toEqual([]);
    expect(context.items).toEqual([]);
  });

  it("adds and tracks facts with evidence references", () => {
    const manager = createWorkingContext();
    const ref = { kind: "email", id: "m1", digest: "abc123" };
    
    manager.addFact("Test fact content", ref);
    
    const context = manager.getContext();
    expect(context.summary).toContain("[FACT]");
    expect(context.summary).toContain("Test fact content");
    expect(manager.hasRef("m1")).toBe(true);
    expect(manager.getRefsByKind("email")).toEqual([ref]);
  });

  it("adds inferences with confidence and source references", () => {
    const manager = createWorkingContext();
    const refs = [
      { kind: "email", id: "m1", digest: "abc123" },
      { kind: "email", id: "m2", digest: "def456" },
    ];
    
    manager.addInference("Test inference", 0.85, refs);
    
    const context = manager.getContext();
    expect(context.summary).toContain("[INFERENCE]");
    expect(context.summary).toContain("Test inference");
    expect(context.summary).toContain("confidence=0.85");
    expect(manager.hasRef("m1")).toBe(true);
    expect(manager.hasRef("m2")).toBe(true);
  });

  it("manages goals, decisions, and open questions", () => {
    const manager = createWorkingContext();
    
    manager.setGoal("Clean up inbox");
    manager.addDecision("Archive newsletters");
    manager.addDecision("Star important emails");
    manager.addOpenQuestion("Should I archive this sender?");
    
    const context = manager.getContext();
    expect(context.goal).toBe("Clean up inbox");
    expect(context.decisionsSoFar).toEqual(["Archive newsletters", "Star important emails"]);
    expect(context.openQuestions).toEqual(["Should I archive this sender?"]);
    expect(context.summary).toContain("## Goal");
    expect(context.summary).toContain("## Decisions");
    expect(context.summary).toContain("## Open Questions");
  });

  it("updates from context updates array", () => {
    const manager = createWorkingContext();
    
    manager.updateFrom([
      { type: "fact", content: "Fact 1", refs: [{ kind: "email", id: "m1", digest: "a" }] },
      { type: "inference", content: "Inference 1", confidence: 0.7, refs: [{ kind: "email", id: "m2", digest: "b" }] },
      { type: "external", content: "External source", sourceUrl: "https://example.com" },
    ]);
    
    const context = manager.getContext();
    expect(context.summary).toContain("[FACT]");
    expect(context.summary).toContain("[INFERENCE]");
    expect(context.summary).toContain("[EXTERNAL]");
    expect(context.summary).toContain("https://example.com");
  });

  it("finds items by evidence kind", () => {
    const manager = createWorkingContext();
    const emailRef = { kind: "email", id: "m1", digest: "a" };
    const memoryRef = { kind: "memory_entry", id: "mem1", digest: "b" };
    
    manager.addFact("Email fact", emailRef);
    manager.addFact("Memory fact", memoryRef);
    
    const emailItems = manager.findItemsByKind("email");
    const memoryItems = manager.findItemsByKind("memory_entry");
    
    expect(emailItems.length).toBe(1);
    expect(memoryItems.length).toBe(1);
  });

  it("clears all context", () => {
    const manager = createWorkingContext();
    manager.addFact("Test", { kind: "email", id: "m1", digest: "a" });
    manager.setGoal("Test goal");
    
    manager.clear();
    
    const context = manager.getContext();
    expect(context.summary).toBe("");
    expect(context.refs).toEqual([]);
    expect(context.items).toEqual([]);
    expect(context.goal).toBeUndefined();
  });
});