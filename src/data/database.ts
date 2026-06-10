import { promises as fs } from "node:fs";
import path from "node:path";

export interface Migration {
  version: number;
  name: string;
  up: string;
  down?: string;
}

export interface DatabaseOptions {
  filePath: string;
  verbose?: boolean;
}

export class Database {
  private db: unknown;
  private migrations: Migration[] = [];
  private readonly filePath: string;
  private readonly verbose: boolean;

  constructor(options: DatabaseOptions) {
    this.filePath = options.filePath;
    this.verbose = options.verbose ?? false;
    this.loadMigrations();
  }

  private loadMigrations(): void {
    this.migrations = [
      {
        version: 1,
        name: "create_preferences_table",
        up: `
          CREATE TABLE preferences (
            id TEXT PRIMARY KEY,
            scope TEXT NOT NULL,
            key TEXT NOT NULL,
            value_json TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'active',
            learned_from TEXT,
            learned_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(scope, key)
          );
          CREATE INDEX idx_preferences_scope_key ON preferences(scope, key);
          CREATE INDEX idx_preferences_status ON preferences(status);
        `,
      },
      {
        version: 2,
        name: "create_preference_history_table",
        up: `
          CREATE TABLE preference_history (
            id TEXT PRIMARY KEY,
            preference_id TEXT NOT NULL,
            action TEXT NOT NULL,
            previous_json TEXT,
            next_json TEXT,
            reason TEXT,
            task_id TEXT,
            email_id TEXT,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_preference_history_preference_id ON preference_history(preference_id);
          CREATE INDEX idx_preference_history_created_at ON preference_history(created_at);
        `,
      },
      {
        version: 3,
        name: "create_decision_logs_table",
        up: `
          CREATE TABLE decision_logs (
            id TEXT PRIMARY KEY,
            task_id TEXT,
            email_id TEXT NOT NULL,
            sender TEXT NOT NULL,
            subject TEXT,
            original_category TEXT,
            suggested_action TEXT,
            final_action TEXT,
            user_response TEXT,
            confidence REAL,
            reason TEXT,
            metadata_json TEXT,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_decision_logs_sender ON decision_logs(sender);
          CREATE INDEX idx_decision_logs_task_id ON decision_logs(task_id);
          CREATE INDEX idx_decision_logs_created_at ON decision_logs(created_at);
        `,
      },
      {
        version: 4,
        name: "create_memory_items_table",
        up: `
          CREATE TABLE memory_items (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            source_table TEXT,
            source_id TEXT,
            title TEXT,
            content TEXT NOT NULL,
            metadata_json TEXT,
            importance REAL NOT NULL DEFAULT 0.5,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
          );
          CREATE INDEX idx_memory_items_type ON memory_items(type);
          CREATE INDEX idx_memory_items_source ON memory_items(source_table, source_id);
          CREATE INDEX idx_memory_items_status ON memory_items(status);
        `,
      },
      {
        version: 5,
        name: "create_embeddings_table",
        up: `
          CREATE TABLE embeddings (
            id TEXT PRIMARY KEY,
            memory_item_id TEXT NOT NULL,
            model TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            content_hash TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_embeddings_memory_item_id ON embeddings(memory_item_id);
          CREATE INDEX idx_embeddings_model ON embeddings(model);
          CREATE INDEX idx_embeddings_content_hash ON embeddings(content_hash);
        `,
      },
      {
        version: 6,
        name: "create_tasks_table",
        up: `
          CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            sop TEXT NOT NULL,
            status TEXT NOT NULL,
            invocation_json TEXT NOT NULL,
            progress_json TEXT,
            exit_reason TEXT,
            started_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            ended_at TEXT
          );
          CREATE INDEX idx_tasks_status ON tasks(status);
          CREATE INDEX idx_tasks_started_at ON tasks(started_at);
        `,
      },
      {
        version: 7,
        name: "create_checkpoints_table",
        up: `
          CREATE TABLE checkpoints (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            phase TEXT,
            budget_json TEXT,
            state_json TEXT,
            digest TEXT,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_checkpoints_task_id ON checkpoints(task_id);
        `,
      },
      {
        version: 8,
        name: "create_reports_table",
        up: `
          CREATE TABLE reports (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            path TEXT,
            title TEXT,
            summary TEXT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_reports_task_id ON reports(task_id);
        `,
      },
    ];
  }

  async open(): Promise<void> {
    const sqlite = await import("sqlite3");
    const Database = sqlite.Database;

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    return new Promise((resolve, reject) => {
      this.db = new Database(this.filePath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      (this.db as { close: (cb: (err?: Error) => void) => void }).close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async run(sql: string, params: unknown[] = []): Promise<{ lastID: number; changes: number }> {
    if (!this.db) throw new Error("Database not open");
    
    return new Promise((resolve, reject) => {
      (this.db as { run: (sql: string, params: unknown[], cb: (this: { lastID: number; changes: number }, err: Error | null) => void) => void })
        .run(sql, params, function (err) {
          if (err) reject(err);
          else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    if (!this.db) throw new Error("Database not open");
    
    return new Promise((resolve, reject) => {
      (this.db as { get: (sql: string, params: unknown[], cb: (err: Error | null, row: T | undefined) => void) => void })
        .get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
    });
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.db) throw new Error("Database not open");
    
    return new Promise((resolve, reject) => {
      (this.db as { all: (sql: string, params: unknown[], cb: (err: Error | null, rows: T[]) => void) => void })
        .all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
    });
  }

  async migrate(): Promise<void> {
    await this.ensureMigrationTable();
    const currentVersion = await this.getCurrentVersion();
    
    for (const migration of this.migrations) {
      if (migration.version > currentVersion) {
        if (this.verbose) {
          console.log(`Applying migration ${migration.version}: ${migration.name}`);
        }
        await this.run(migration.up);
        await this.recordMigration(migration.version, migration.name);
      }
    }
    
    if (this.verbose) {
      const finalVersion = await this.getCurrentVersion();
      console.log(`Database migrated to version ${finalVersion}`);
    }
  }

  async getCurrentVersion(): Promise<number> {
    const row = await this.get<{ version: number }>(
      "SELECT version FROM migrations ORDER BY version DESC LIMIT 1"
    );
    return row?.version ?? 0;
  }

  private async ensureMigrationTable(): Promise<void> {
    await this.run(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
  }

  private async recordMigration(version: number, name: string): Promise<void> {
    await this.run(
      "INSERT INTO migrations (version, name, applied_at) VALUES (?, ?, ?)",
      [version, name, new Date().toISOString()]
    );
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.run("BEGIN TRANSACTION");
    try {
      const result = await fn();
      await this.run("COMMIT");
      return result;
    } catch (err) {
      await this.run("ROLLBACK");
      throw err;
    }
  }
}

export async function createDatabase(filePath: string): Promise<Database> {
  const db = new Database({ filePath, verbose: true });
  await db.open();
  await db.migrate();
  return db;
}

export function getDefaultDatabasePath(stateDir: string = ".mailtidy"): string {
  return path.join(stateDir, "mailtidy.sqlite");
}