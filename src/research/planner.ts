/**
 * 研究计划：将研究型分析与邮件动作分离。
 *
 * Phase 3.3 实现：
 *   - ResearchPlanner 管理研究任务队列
 *   - 支持研究优先级和依赖关系
 *   - 将研究结果与邮件动作解耦
 */

import type { InvestigationSuggestion, InvestigationResult } from "../data/models.js";

export interface ResearchTask {
  id: string;
  emailId: string;
  type: "web_search" | "verify_domain" | "check_sender";
  query: string;
  priority: "low" | "medium" | "high";
  status: "pending" | "running" | "completed" | "failed";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

export interface ResearchPlan {
  emailId: string;
  tasks: ResearchTask[];
  requiresInvestigation: boolean;
  reason: string;
}

export class ResearchPlanner {
  private tasks: Map<string, ResearchTask> = new Map();

  createPlan(
    emailId: string,
    suggestions: InvestigationSuggestion[],
  ): ResearchPlan {
    const tasks: ResearchTask[] = [];

    for (const suggestion of suggestions) {
      const task = this.createTask(emailId, suggestion);
      tasks.push(task);
      this.tasks.set(task.id, task);
    }

    return {
      emailId,
      tasks,
      requiresInvestigation: tasks.length > 0,
      reason: tasks.length > 0
        ? `Research needed: ${tasks.length} investigation(s) required`
        : "No research required",
    };
  }

  private createTask(emailId: string, suggestion: InvestigationSuggestion): ResearchTask {
    const now = new Date().toISOString();
    const id = `research_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    let query = "";
    let type: ResearchTask["type"] = "web_search";

    if (suggestion.suggestedTool === "web_search") {
      query = suggestion.suggestedArgs.query as string;
      type = "web_search";
    } else if (suggestion.suggestedTool === "verify_domain") {
      query = suggestion.suggestedArgs.domain as string;
      type = "verify_domain";
    } else if (suggestion.suggestedTool === "check_sender") {
      query = suggestion.suggestedArgs.sender as string;
      type = "check_sender";
    }

    return {
      id,
      emailId,
      type,
      query,
      priority: suggestion.priority,
      status: "pending",
      createdAt: now,
    };
  }

  getTask(id: string): ResearchTask | undefined {
    return this.tasks.get(id);
  }

  updateTask(id: string, updates: Partial<ResearchTask>): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;

    this.tasks.set(id, { ...task, ...updates });
    return true;
  }

  getPendingTasks(): ResearchTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === "pending");
  }

  getTasksByEmail(emailId: string): ResearchTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.emailId === emailId);
  }

  recordResult(taskId: string, result: InvestigationResult): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    return this.updateTask(taskId, {
      status: result.isError ? "failed" : "completed",
      completedAt: new Date().toISOString(),
      result: result.observation,
      error: result.isError ? "Tool execution failed" : undefined,
    });
  }

  clearEmailTasks(emailId: string): void {
    const tasks = this.getTasksByEmail(emailId);
    for (const task of tasks) {
      this.tasks.delete(task.id);
    }
  }

  getResearchSummary(emailId: string): {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    results: unknown[];
  } {
    const tasks = this.getTasksByEmail(emailId);
    return {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === "completed").length,
      failed: tasks.filter((t) => t.status === "failed").length,
      pending: tasks.filter((t) => t.status === "pending").length,
      results: tasks.filter((t) => t.result !== undefined).map((t) => t.result),
    };
  }
}