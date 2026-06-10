import type { Database } from "./database.js";
import type { LearningSignal } from "./learning.js";

export interface DecisionLogRecord {
  id: string;
  task_id?: string;
  email_id: string;
  sender: string;
  subject?: string;
  original_category: string;
  suggested_action: string;
  final_action?: string;
  user_response?: string;
  confidence?: number;
  reason?: string;
  metadata_json?: string;
  created_at: string;
}

export interface DecisionLogQuery {
  taskId?: string;
  sender?: string;
  signalType?: LearningSignal["type"];
  since?: string;
  until?: string;
  limit?: number;
}

export class DecisionLogRepository {
  constructor(private readonly db: Database) {}

  async createLog(signal: LearningSignal, taskId: string): Promise<DecisionLogRecord> {
    const now = new Date().toISOString();
    const id = this.generateId("log");
    const metadataJson = signal.metadata ? JSON.stringify(signal.metadata) : null;

    await this.db.run(
      `INSERT INTO decision_logs 
       (id, task_id, email_id, sender, subject, original_category, suggested_action, 
        final_action, user_response, confidence, reason, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        taskId,
        signal.emailId,
        signal.sender,
        signal.metadata?.subject,
        signal.originalCategory,
        signal.suggestedAction,
        signal.userResponse ? "confirmed" : undefined,
        signal.userResponse,
        signal.metadata?.confidence,
        signal.metadata?.reason,
        metadataJson,
        now,
      ]
    );

    return {
      id,
      task_id: taskId,
      email_id: signal.emailId,
      sender: signal.sender,
      subject: signal.metadata?.subject as string | undefined,
      original_category: signal.originalCategory,
      suggested_action: signal.suggestedAction,
      final_action: signal.userResponse ? "confirmed" : undefined,
      user_response: signal.userResponse,
      confidence: signal.metadata?.confidence as number | undefined,
      reason: signal.metadata?.reason as string | undefined,
      metadata_json: metadataJson ?? undefined,
      created_at: now,
    };
  }

  async queryLogs(query: DecisionLogQuery = {}): Promise<DecisionLogRecord[]> {
    let sql = "SELECT * FROM decision_logs WHERE 1=1";
    const params: unknown[] = [];

    if (query.taskId) {
      sql += " AND task_id = ?";
      params.push(query.taskId);
    }

    if (query.sender) {
      sql += " AND sender = ?";
      params.push(query.sender);
    }

    if (query.since) {
      sql += " AND created_at >= ?";
      params.push(query.since);
    }

    if (query.until) {
      sql += " AND created_at <= ?";
      params.push(query.until);
    }

    sql += " ORDER BY created_at DESC";

    if (query.limit) {
      sql += " LIMIT ?";
      params.push(query.limit);
    }

    return this.db.all<DecisionLogRecord>(sql, params);
  }

  async getRecentLogs(days: number = 7, limit: number = 1000): Promise<DecisionLogRecord[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    return this.queryLogs({ since: since.toISOString(), limit });
  }

  async getBySender(sender: string, limit: number = 100): Promise<DecisionLogRecord[]> {
    return this.queryLogs({ sender, limit });
  }

  async getById(id: string): Promise<DecisionLogRecord | undefined> {
    return this.db.get<DecisionLogRecord>("SELECT * FROM decision_logs WHERE id = ?", [id]);
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}