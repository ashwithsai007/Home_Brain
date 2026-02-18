// src/lib/privacyAudit.ts
import path from "path";
import fs from "fs";
import crypto from "crypto";
import Database from "better-sqlite3";
import { dataDir, ensureDir } from "@/lib/storage";

type EncryptedBlob = {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;  // base64
  tag: string; // base64
  ct: string;  // base64
};

function auditDir() {
  const dir = dataDir();
  ensureDir(dir);
  return dir;
}

function keyPath() {
  return path.join(auditDir(), ".privacy-audit-key");
}

function getOrCreateKey(): Buffer {
  const kp = keyPath();

  if (fs.existsSync(kp)) {
    const raw = fs.readFileSync(kp, "utf8").trim();
    const buf = Buffer.from(raw, "base64");
    if (buf.length !== 32) throw new Error("Invalid privacy audit key length");
    return buf;
  }

  const key = crypto.randomBytes(32);
  fs.writeFileSync(kp, key.toString("base64"), { mode: 0o600 });
  try {
    fs.chmodSync(kp, 0o600);
  } catch {}
  return key;
}

function encryptText(plain: string): EncryptedBlob {
  const key = getOrCreateKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plain, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    v: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  };
}

function jsonEnc(plain: string) {
  return JSON.stringify(encryptText(plain));
}

let _db: Database.Database | null = null;

function dbPath() {
  return path.join(auditDir(), "privacy-audit.sqlite");
}

function auditDb() {
  if (_db) return _db;
  _db = new Database(dbPath());
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  return _db;
}

export function initPrivacyAudit() {
  const d = auditDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS audit_requests (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      chat_id TEXT,
      project_id TEXT,
      mode TEXT,
      provider TEXT,
      model TEXT,
      blocked INTEGER NOT NULL DEFAULT 0,
      block_reason TEXT,
      redactions_json TEXT,
      original_enc TEXT,
      sanitized_enc TEXT,
      map_enc TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_responses (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      response_enc TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_requests_ts ON audit_requests(ts);
    CREATE INDEX IF NOT EXISTS idx_audit_responses_req ON audit_responses(request_id);
  `);
}

export function auditStoreRequest(args: {
  id: string;
  ts: number;
  chatId: string;
  projectId: string;
  mode: string;
  provider: string;
  model: string;
  blocked: boolean;
  blockReason?: string;
  redactionsJson?: string;
  original?: string;
  sanitized?: string;
  map?: Record<string, string>;
}) {
  initPrivacyAudit();
  const d = auditDb();

  d.prepare(
    `INSERT INTO audit_requests
     (id, ts, chat_id, project_id, mode, provider, model, blocked, block_reason, redactions_json,
      original_enc, sanitized_enc, map_enc)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    args.id,
    args.ts,
    args.chatId,
    args.projectId,
    args.mode,
    args.provider,
    args.model,
    args.blocked ? 1 : 0,
    args.blockReason || null,
    args.redactionsJson || null,
    args.original ? jsonEnc(args.original) : null,
    args.sanitized ? jsonEnc(args.sanitized) : null,
    args.map ? jsonEnc(JSON.stringify(args.map)) : null
  );
}

export function auditStoreResponse(args: {
  id: string;
  requestId: string;
  ts: number;
  response: string;
}) {
  initPrivacyAudit();
  const d = auditDb();

  d.prepare(
    `INSERT INTO audit_responses (id, request_id, ts, response_enc)
     VALUES (?, ?, ?, ?)`
  ).run(args.id, args.requestId, args.ts, jsonEnc(args.response));
}