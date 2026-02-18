// src/lib/db.ts
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto"; // ✅ FIX: ensure randomUUID is available consistently

export function dataDir() {
  const v = process.env.HOME_BRAIN_DATA_DIR;
  if (v && v.trim()) return v.trim();
  return `${os.homedir()}/home-brain-data`;
}

export function ensureDataDir() {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "files"), { recursive: true });
}

let _db: Database.Database | null = null;

export function db() {
  if (_db) return _db;
  ensureDataDir();
  const dbPath = path.join(dataDir(), "homebrain.sqlite");
  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  return _db;
}

function addColumnSafe(d: Database.Database, sql: string) {
  try {
    d.exec(sql);
  } catch {
    // ignore if column already exists
  }
}

export function initDb() {
  const d = db();

  d.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      ts INTEGER NOT NULL,
      FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      disk_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id);
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
    CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
  `);

  // ✅ Migrations: add provider/model to chats
  addColumnSafe(d, `ALTER TABLE chats ADD COLUMN provider TEXT`);
  addColumnSafe(d, `ALTER TABLE chats ADD COLUMN model TEXT`);

  // ✅ Backfill defaults for existing rows (safe)
  try {
    d.prepare(`UPDATE chats SET provider = COALESCE(provider, 'openai')`).run();
    d.prepare(`UPDATE chats SET model = COALESCE(model, 'gpt-5-mini')`).run();
  } catch {}

  // Seed if empty
  const row = d.prepare(`SELECT COUNT(*) as n FROM projects`).get() as { n: number };
  if (row.n === 0) {
    const t = Date.now();
    const projectId = crypto.randomUUID();
    const chatId = crypto.randomUUID();

    d.prepare(`INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
      projectId,
      "Personal",
      t,
      t
    );

    // ✅ include provider/model
    d.prepare(
      `INSERT INTO chats (id, project_id, title, created_at, updated_at, provider, model)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(chatId, projectId, "New chat", t, t, "openai", "gpt-5-mini");

    d.prepare(`INSERT INTO messages (id, chat_id, role, content, ts) VALUES (?, ?, ?, ?, ?)`).run(
      crypto.randomUUID(),
      chatId,
      "assistant",
      "Home Brain is ready.\n\nNow backed by SQLite + disk storage.",
      t
    );
  }
}