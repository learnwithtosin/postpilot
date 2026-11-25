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

// Daily check-ins: one row per day (date in the check-in timezone), with my notes as the daily log.
export type CheckinStatus = "sent" | "answered" | "skipped";

export interface CheckinRow {
  date: string; // YYYY-MM-DD
  day: number; // Day N of the sprint
  status: CheckinStatus;
  notes: string | null;
  sent_at: string | null;
  reminded_at: string | null;
  answered_at: string | null;
}

db.exec(`CREATE TABLE IF NOT EXISTS checkins (
  date TEXT PRIMARY KEY,
  day INTEGER NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  sent_at TEXT,
  reminded_at TEXT,
  answered_at TEXT
)`);

export function getCheckin(date: string): CheckinRow | undefined {
  return db.prepare("SELECT * FROM checkins WHERE date = ?").get(date) as CheckinRow | undefined;
}

/** Record that today's check-in was sent (again, for /checkin), clearing any earlier reminder. */
export function markCheckinSent(date: string, day: number): void {
  db.prepare(
    `INSERT INTO checkins (date, day, status, sent_at) VALUES (?, ?, 'sent', datetime('now'))
     ON CONFLICT(date) DO UPDATE SET status = 'sent', day = excluded.day, sent_at = excluded.sent_at, reminded_at = NULL`,
  ).run(date, day);
}

export function markCheckinSkipped(date: string, day: number): void {
  db.prepare(
    `INSERT INTO checkins (date, day, status) VALUES (?, ?, 'skipped')
     ON CONFLICT(date) DO UPDATE SET status = 'skipped'`,
  ).run(date, day);
}

export function markReminded(date: string): void {
  db.prepare("UPDATE checkins SET reminded_at = datetime('now') WHERE date = ?").run(date);
}

export function saveCheckinNotes(date: string, notes: string): void {
  db.prepare("UPDATE checkins SET status = 'answered', notes = ?, answered_at = datetime('now') WHERE date = ?").run(
    notes,
    date,
  );
}
