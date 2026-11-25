// Daily check-in settings and time helpers. The bot wires these up in src/bot.ts.
import { config } from "dotenv";

config({ quiet: true });

export const TIMEZONE = "Africa/Lagos";
export const SPRINT_DAYS = 30;
export const REMINDER_AFTER_MS = 6 * 60 * 60 * 1000;

/** CHECKIN_TIME (HH:MM) and SPRINT_START (YYYY-MM-DD) from .env, or an error explaining what's wrong. */
export function checkinSettings(): { time: string; start: string } | { error: string } {
  const time = process.env.CHECKIN_TIME?.trim() ?? "";
  const start = process.env.SPRINT_START?.trim() ?? "";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: "CHECKIN_TIME in .env should look like 09:00." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(Date.parse(start))) {
    return { error: "SPRINT_START in .env should look like 2026-11-21." };
  }
  return { time, start };
}

/** Today's date (YYYY-MM-DD) and time (HH:MM) in Lagos. */
export function lagosNow(): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Day N of the sprint for a date: SPRINT_START is Day 1. */
export function dayNumber(date: string, start: string): number {
  return Math.round((Date.parse(date) - Date.parse(start)) / 86_400_000) + 1;
}
