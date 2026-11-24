// Drafts in SQLite (data/postpilot.db).
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import type { Platform } from "./drafting.js";

export type Status = "pending" | "approved" | "edited" | "skipped";

export interface DraftRow {
  id: number;
  platform: Platform;
  topic: string;
  text: string;
  edited_text: string | null;
  status: Status;
  created_at: string;
  updated_at: string;
}

mkdirSync("data", { recursive: true });
const db = new Database("data/postpilot.db");
db.pragma("journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL,
  topic TEXT NOT NULL,
  text TEXT NOT NULL,
  edited_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

export function saveDraft(platform: Platform, topic: string, text: string): number {
  const result = db.prepare("INSERT INTO drafts (platform, topic, text) VALUES (?, ?, ?)").run(platform, topic, text);
  return Number(result.lastInsertRowid);
}

export function getDraft(id: number): DraftRow | undefined {
  return db.prepare("SELECT * FROM drafts WHERE id = ?").get(id) as DraftRow | undefined;
}

export function setStatus(id: number, status: Status, editedText?: string): void {
  db.prepare(
    "UPDATE drafts SET status = ?, edited_text = COALESCE(?, edited_text), updated_at = datetime('now') WHERE id = ?",
  ).run(status, editedText ?? null, id);
}
