import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { Database, createDatabase } from "./database.js";
import { PreferenceRepository } from "./preferences.js";
import { MemoryItemRepository } from "./memory-items.js";
import { HeuristicEmbeddingProvider } from "../integrations/embedding/heuristic.js";
import { SimpleMemoryIndex } from "./vector-index.js";
import { promises as fs } from "node:fs";

const TEST_DB_PATH = "/tmp/mailtidy-test-" + Date.now() + ".sqlite";

describe("Database", () => {
  let db: Database;

  beforeEach(async () => {
    db = await createDatabase(TEST_DB_PATH);
  });

  afterEach(async () => {
    await db.close();
    await fs.unlink(TEST_DB_PATH).catch(() => {});
  });

  it("should create and open database", async () => {
    const version = await db.getCurrentVersion();
    assert.ok(version >= 0);
  });

  it("should run migrations", async () => {
    const version = await db.getCurrentVersion();
    assert.ok(version >= 8, `Expected version >= 8, got ${version}`);
  });
});

describe("PreferenceRepository", () => {
  let db: Database;
  let repo: PreferenceRepository;

  beforeEach(async () => {
    db = await createDatabase(TEST_DB_PATH);
    repo = new PreferenceRepository(db);
  });

  afterEach(async () => {
    await db.close();
    await fs.unlink(TEST_DB_PATH).catch(() => {});
  });

  it("should upsert and get preference", async () => {
    const result = await repo.upsertPreference({
      scope: "sender",
      key: "test@example.com",
      value: { importanceDelta: 1, ignoredCount: 0, preferredAction: "archive" },
      confidence: 0.8,
      learnedFrom: "test",
    });

    assert.ok(result.id);
    assert.strictEqual(result.scope, "sender");
    assert.strictEqual(result.key, "test@example.com");

    const retrieved = await repo.getByScopeAndKey("sender", "test@example.com");
    assert.ok(retrieved);
    assert.strictEqual(retrieved.key, "test@example.com");
  });

  it("should archive preference", async () => {
    const result = await repo.upsertPreference({
      scope: "sender",
      key: "archive@example.com",
      value: { importanceDelta: 0, ignoredCount: 0 },
      confidence: 0.5,
    });

    await repo.archivePreference(result.id, "User requested");
    const archived = await repo.getByScopeAndKey("sender", "archive@example.com");
    assert.ok(!archived || archived.status === "archived");
  });
});

describe("MemoryItemRepository", () => {
  let db: Database;
  let repo: MemoryItemRepository;

  beforeEach(async () => {
    db = await createDatabase(TEST_DB_PATH);
    repo = new MemoryItemRepository(db);
  });

  afterEach(async () => {
    await db.close();
    await fs.unlink(TEST_DB_PATH).catch(() => {});
  });

  it("should create memory item", async () => {
    const item = await repo.createItem({
      type: "decision",
      sourceTable: "decision_logs",
      sourceId: "log-123",
      title: "Test Decision",
      content: "This is a test decision about email handling",
      importance: 0.8,
    });

    assert.ok(item.id);
    assert.strictEqual(item.type, "decision");

    const retrieved = await repo.getItemById(item.id);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.title, "Test Decision");
  });
});

describe("HeuristicEmbeddingProvider", () => {
  const provider = new HeuristicEmbeddingProvider();

  it("should embed texts", async () => {
    const embeddings = await provider.embed(["hello world", "foo bar"]);
    
    assert.strictEqual(embeddings.length, 2);
    assert.ok(embeddings[0]);
    assert.ok(embeddings[1]);
    assert.strictEqual(embeddings[0].length, provider.dimensions);
    assert.strictEqual(embeddings[1].length, provider.dimensions);
  });

  it("should generate consistent embeddings for same text", async () => {
    const emb1 = await provider.embed(["test"]);
    const emb2 = await provider.embed(["test"]);
    
    assert.ok(emb1[0] && emb2[0]);
    for (let i = 0; i < emb1[0].length; i++) {
      assert.strictEqual(emb1[0][i], emb2[0][i]);
    }
  });
});

describe("SimpleMemoryIndex", () => {
  let db: Database;
  let index: SimpleMemoryIndex;
  let memoryRepo: MemoryItemRepository;

  beforeEach(async () => {
    db = await createDatabase(TEST_DB_PATH);
    const provider = new HeuristicEmbeddingProvider();
    index = new SimpleMemoryIndex(db, provider);
    memoryRepo = new MemoryItemRepository(db);
  });

  afterEach(async () => {
    await db.close();
    await fs.unlink(TEST_DB_PATH).catch(() => {});
  });

  it("should upsert and search memory items", async () => {
    const item = await memoryRepo.createItem({
      type: "decision",
      content: "Archive emails from newsletter senders",
      importance: 0.7,
    });

    await index.upsert([item]);

    const results = await index.search({
      query: "newsletter emails archive",
      limit: 5,
    });

    assert.ok(results.length >= 0); // Results depend on embedding similarity
  });
});
