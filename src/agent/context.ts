/**
 * Working context：长上下文压缩与"按需回查原记录"机制。
 *
 * §2.2.3 上下文分层在这里落实：
 *   - L0 任务目标：用户原始请求、当前 task goal、预算、退出条件
 *   - L1 工作摘要：当前已处理什么、剩什么、关键判断、未解决问题
 *   - L2 证据摘要：邮件摘要、thread 摘要、记忆摘要、规则命中摘要
 *   - L3 可回查索引：emailId、messageId、traceStepId、memoryKey、reportPath
 *   - L4 原始记录：邮件正文、完整 trace、完整历史决策、原始搜索结果
 *
 * 思路：超长 thread / 大量证据时先用 compression.ts 摘要 → 写入 WorkingContext，
 * 主循环只持有摘要 + EvidenceRef 指针；需要时再用 ref 拉回原始内容。
 */

export interface EvidenceRef {
  kind: "email" | "search_result" | "web_page" | "memory_entry";
  id: string;
  digest: string;
}

export interface FactItem {
  type: "fact";
  content: string;
  sourceRef: EvidenceRef;
  timestamp: string;
}

export interface InferenceItem {
  type: "inference";
  content: string;
  confidence: number;
  sourceRefs: EvidenceRef[];
  timestamp: string;
}

export interface ExternalSourceItem {
  type: "external";
  content: string;
  sourceUrl?: string;
  timestamp: string;
}

export type ContextItem = FactItem | InferenceItem | ExternalSourceItem;

export interface WorkingContext {
  summary: string;
  refs: EvidenceRef[];
  items?: ContextItem[];
  goal?: string;
  decisionsSoFar?: string[];
  openQuestions?: string[];
  budgetLeft?: { steps: number; tokens: number };
}

export interface ContextUpdate {
  type: "fact" | "inference" | "external";
  content: string;
  refs?: EvidenceRef[];
  confidence?: number;
  sourceUrl?: string;
}

export class WorkingContextManager {
  private context: WorkingContext;

  constructor(initial?: Partial<WorkingContext>) {
    this.context = {
      summary: "",
      refs: [],
      items: [],
      ...initial,
    };
  }

  getContext(): WorkingContext {
    return { ...this.context };
  }

  addItem(item: ContextItem): void {
    this.context.items?.push(item);
    this.context.refs.push(...this.getRefsFromItem(item));
    this.updateSummary();
  }

  addItems(items: ContextItem[]): void {
    for (const item of items) {
      this.addItem(item);
    }
  }

  updateFrom(updates: ContextUpdate[]): void {
    for (const update of updates) {
      const item = this.createItemFromUpdate(update);
      this.addItem(item);
    }
  }

  addFact(content: string, sourceRef: EvidenceRef): void {
    const item: FactItem = {
      type: "fact",
      content,
      sourceRef,
      timestamp: new Date().toISOString(),
    };
    this.addItem(item);
  }

  addInference(content: string, confidence: number, sourceRefs: EvidenceRef[]): void {
    const item: InferenceItem = {
      type: "inference",
      content,
      confidence,
      sourceRefs,
      timestamp: new Date().toISOString(),
    };
    this.addItem(item);
  }

  addExternal(content: string, sourceUrl?: string): void {
    const item: ExternalSourceItem = {
      type: "external",
      content,
      sourceUrl,
      timestamp: new Date().toISOString(),
    };
    this.addItem(item);
  }

  setGoal(goal: string): void {
    this.context.goal = goal;
    this.updateSummary();
  }

  addDecision(decision: string): void {
    if (!this.context.decisionsSoFar) {
      this.context.decisionsSoFar = [];
    }
    this.context.decisionsSoFar.push(decision);
    this.updateSummary();
  }

  addOpenQuestion(question: string): void {
    if (!this.context.openQuestions) {
      this.context.openQuestions = [];
    }
    this.context.openQuestions.push(question);
    this.updateSummary();
  }

  setBudgetLeft(budget: { steps: number; tokens: number }): void {
    this.context.budgetLeft = budget;
  }

  findItemsByKind(kind: EvidenceRef["kind"]): ContextItem[] {
    if (!this.context.items) return [];
    return this.context.items.filter((item) => {
      if (item.type === "fact") {
        return item.sourceRef.kind === kind;
      }
      if (item.type === "inference") {
        return item.sourceRefs.some((ref) => ref.kind === kind);
      }
      return false;
    });
  }

  getRefsByKind(kind: EvidenceRef["kind"]): EvidenceRef[] {
    return this.context.refs.filter((ref) => ref.kind === kind);
  }

  hasRef(id: string): boolean {
    return this.context.refs.some((ref) => ref.id === id);
  }

  private createItemFromUpdate(update: ContextUpdate): ContextItem {
    const timestamp = new Date().toISOString();
    const refs = update.refs ?? [];

    switch (update.type) {
      case "fact":
        return {
          type: "fact",
          content: update.content,
          sourceRef: refs[0] ?? { kind: "memory_entry", id: `fact:${timestamp}`, digest: "" },
          timestamp,
        };
      case "inference":
        return {
          type: "inference",
          content: update.content,
          confidence: update.confidence ?? 0.7,
          sourceRefs: refs,
          timestamp,
        };
      case "external":
        return {
          type: "external",
          content: update.content,
          sourceUrl: update.sourceUrl,
          timestamp,
        };
    }
  }

  private getRefsFromItem(item: ContextItem): EvidenceRef[] {
    if (item.type === "fact") {
      return [item.sourceRef];
    }
    if (item.type === "inference") {
      return item.sourceRefs;
    }
    return [];
  }

  private updateSummary(): void {
    const parts: string[] = [];

    if (this.context.goal) {
      parts.push(`## Goal\n${this.context.goal}`);
    }

    if (this.context.decisionsSoFar?.length) {
      parts.push(`## Decisions (${this.context.decisionsSoFar.length})`);
      parts.push(...this.context.decisionsSoFar.map((d, i) => `${i + 1}. ${d}`));
    }

    if (this.context.openQuestions?.length) {
      parts.push(`## Open Questions (${this.context.openQuestions.length})`);
      parts.push(...this.context.openQuestions.map((q) => `- ${q}`));
    }

    if (this.context.items?.length) {
      const facts = this.context.items.filter((i) => i.type === "fact");
      const inferences = this.context.items.filter((i) => i.type === "inference");
      const external = this.context.items.filter((i) => i.type === "external");

      if (facts.length) {
        parts.push(`## Facts (${facts.length})`);
        parts.push(...facts.map((f) => `[FACT] ${f.content}`));
      }

      if (inferences.length) {
        parts.push(`## Inferences (${inferences.length})`);
        parts.push(
          ...inferences.map((i) => `[INFERENCE] ${i.content} (confidence=${i.confidence.toFixed(2)})`),
        );
      }

      if (external.length) {
        parts.push(`## External Sources (${external.length})`);
        parts.push(...external.map((e) => `[EXTERNAL] ${e.content}${e.sourceUrl ? ` (${e.sourceUrl})` : ""}`));
      }
    }

    if (this.context.budgetLeft) {
      parts.push(`## Budget Left\nSteps: ${this.context.budgetLeft.steps}, Tokens: ${this.context.budgetLeft.tokens}`);
    }

    this.context.summary = parts.join("\n\n");
  }

  clear(): void {
    this.context = { summary: "", refs: [], items: [] };
  }
}

export function createWorkingContext(initial?: Partial<WorkingContext>): WorkingContextManager {
  return new WorkingContextManager(initial);
}