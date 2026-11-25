// npm run bot: Telegram approval bot (long polling). Only the owner can use it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { REMINDER_AFTER_MS, SPRINT_DAYS, checkinSettings, dayNumber, lagosNow } from "./checkin.js";
import {
  getCheckin,
  getDraft,
  markCheckinSent,
  markCheckinSkipped,
  markReminded,
  saveCheckinNotes,
  saveDraft,
  setStatus,
  type DraftRow,
} from "./db.js";
import { draftPosts, type Draft, type Platform } from "./drafting.js";
import { friendlyError, generate } from "./llm.js";
import { X_LIMIT, removeEmDashes, xLength } from "./text.js";
import { LESSONS_PATH, appendLesson, readLessons } from "./voiceFile.js";

config({ quiet: true });

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set in .env.");
  process.exit(1);
}

const bot = new Bot(token);
let ownerId: number | null = Number(process.env.OWNER_CHAT_ID) || null;

/** What the bot expects the owner's next plain-text message to be. In memory, so a restart forgets it. */
type Waiting =
  | { kind: "edit"; draftId: number }
  | { kind: "editReason"; draftId: number; edited: string }
  | { kind: "skipReason"; draftId: number };
let waiting: Waiting | null = null;

/** Lessons shown with Save / Discard, by key. */
const proposed = new Map<number, string>();
let nextLessonKey = 1;

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function saveOwner(id: number): void {
  const env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
  const line = `OWNER_CHAT_ID=${id}`;
  const updated = /^OWNER_CHAT_ID=.*$/m.test(env)
    ? env.replace(/^OWNER_CHAT_ID=.*$/m, line)
    : `${env.trimEnd()}\n${line}\n`;
  writeFileSync(".env", updated);
}

/** Message the owner; never throws. */
async function tell(text: string, keyboard?: InlineKeyboard): Promise<void> {
  if (!ownerId) return;
  await bot.api.sendMessage(ownerId, text, { reply_markup: keyboard }).catch((err) => {
    console.error(`Couldn't send a Telegram message: ${errorText(err)}`);
  });
}

// Owner gate: the first private /start claims the bot; everyone else is ignored.
bot.use(async (ctx, next) => {
  const chat = ctx.chat;
  if (!chat) return;
  if (ownerId === null) {
    if (chat.type === "private" && ctx.message?.text?.startsWith("/start")) {
      ownerId = chat.id;
      saveOwner(chat.id);
      console.log(`Owner set to chat ${chat.id} and saved to .env.`);
      await ctx.reply("You're the owner now. Send /draft <your notes> to get X and LinkedIn drafts.");
    }
    return;
  }
  if (chat.id === ownerId) await next();
});

bot.command("start", (ctx) => ctx.reply("You're the owner. Send /draft <your notes> to get drafts."));

bot.command("cancel", async (ctx) => {
  waiting = null;
  await ctx.reply("OK, not waiting for anything.");
});

bot.command("draft", async (ctx) => {
  const notes = ctx.match.trim();
  if (!notes) {
    await ctx.reply("Add your notes after the command, e.g.\n/draft Day 6: wired up the Telegram bot");
    return;
  }
  waiting = null;
  await ctx.reply("Drafting...");
  void sendDrafts(notes); // run in the background so the bot keeps answering
});

// Daily check-in: a timer checks every minute, so it catches up if the laptop was asleep at CHECKIN_TIME.
const CHECKIN_TEXT = (day: number) =>
  `Morning. What did you work on yesterday, or what's the plan today? Reply with short notes and I'll draft Day ${day}.`;

/** Today's date and Day N, or a reason the check-in can't run. */
function today(): { date: string; time: string; day: number; checkinTime: string } | { error: string } {
  const settings = checkinSettings();
  if ("error" in settings) return settings;
  const { date, time } = lagosNow();
  const day = dayNumber(date, settings.start);
  if (day < 1 || day > SPRINT_DAYS) return { error: `Today is Day ${day}, outside the ${SPRINT_DAYS}-day sprint. Check SPRINT_START in .env.` };
  return { date, time, day, checkinTime: settings.time };
}

async function sendCheckin(date: string, day: number): Promise<void> {
  waiting = null; // the next reply is the check-in answer
  markCheckinSent(date, day);
  await tell(CHECKIN_TEXT(day));
}

async function checkinTick(): Promise<void> {
  if (!ownerId) return;
  const t = today();
  if ("error" in t) return;
  const row = getCheckin(t.date);
  if (!row && t.time >= t.checkinTime) return sendCheckin(t.date, t.day);
  if (row?.status === "sent" && !row.reminded_at && row.sent_at) {
    const sentAt = Date.parse(`${row.sent_at.replace(" ", "T")}Z`); // SQLite datetime() is UTC
    if (Date.now() - sentAt >= REMINDER_AFTER_MS) {
      markReminded(t.date);
      await tell(`Just a nudge: a few short notes on today is all I need to draft Day ${row.day}. Or /skip_today.`);
    }
  }
}

bot.command("checkin", async (ctx) => {
  const t = today();
  if ("error" in t) return void (await ctx.reply(t.error));
  await sendCheckin(t.date, t.day);
});

bot.command("skip_today", async (ctx) => {
  const t = today();
  if ("error" in t) return void (await ctx.reply(t.error));
  markCheckinSkipped(t.date, t.day);
  await ctx.reply(`OK, no check-in for Day ${t.day}. See you tomorrow.`);
});

async function sendDrafts(notes: string): Promise<void> {
  try {
    const { x, linkedin } = await draftPosts(notes);
    await sendDraft("X", notes, x);
    await sendDraft("LinkedIn", notes, linkedin);
  } catch (err) {
    console.error("Drafting failed:", err);
    await tell(friendlyError(err, "drafting"));
  }
}

async function sendDraft(platform: Platform, notes: string, draft: Draft): Promise<void> {
  const id = saveDraft(platform, notes, draft.text);
  const count = platform === "X" ? ` (${xLength(draft.text)}/${X_LIMIT})` : "";
  const flags = draft.flags.map((f) => `\n\n⚠️ ${f}`).join("");
  const keyboard = new InlineKeyboard().text("Approve", `a:${id}`).text("Edit", `e:${id}`).text("Skip", `s:${id}`);
  await tell(`${platform} draft #${id}${count}\n\n${draft.text}${flags}`, keyboard);
}

// Approve / Edit / Skip buttons.
bot.callbackQuery(/^([aes]):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = Number(ctx.match[2]);
  const draft = getDraft(id);
  if (!draft) return void (await ctx.reply(`Draft #${id} not found.`));
  if (draft.status !== "pending") return void (await ctx.reply(`Draft #${id} is already ${draft.status}.`));

  switch (ctx.match[1]) {
    case "a":
      setStatus(id, "approved");
      await removeButtons(ctx);
      await ctx.reply(`Approved ${draft.platform} draft #${id}. Final text below, ready to copy:`);
      await ctx.reply(draft.text);
      break;
    case "e":
      waiting = { kind: "edit", draftId: id };
      await ctx.reply(`Send your edited version of ${draft.platform} draft #${id}. (/cancel to stop)`);
      break;
    case "s":
      setStatus(id, "skipped");
      await removeButtons(ctx);
      waiting = { kind: "skipReason", draftId: id };
      await ctx.reply(`Skipped ${draft.platform} draft #${id}. Why? Send a reason to turn it into a lesson, or /cancel.`);
      break;
  }
});

async function removeButtons(ctx: Context): Promise<void> {
  await ctx.editMessageReplyMarkup().catch(() => {}); // fine if the message is too old to edit
}

// Plain text: the answer to whatever the bot last asked.
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return void (await ctx.reply("Commands: /draft <notes>, /checkin, /skip_today, /cancel"));
  if (!waiting) {
    const t = today();
    const row = "error" in t ? undefined : getCheckin(t.date);
    if (row?.status === "sent") {
      saveCheckinNotes(row.date, text);
      await ctx.reply(`Got it. Drafting Day ${row.day}...`);
      void sendDrafts(`Day ${row.day} of ${SPRINT_DAYS}: ${text}`);
      return;
    }
  }
  const draft = waiting && getDraft(waiting.draftId);
  if (!waiting || !draft) return void (await ctx.reply("Send /draft <your notes> to get drafts."));

  const current = waiting;
  if (current.kind === "edit") {
    setStatus(draft.id, "edited", text);
    waiting = { kind: "editReason", draftId: draft.id, edited: text };
    const count = draft.platform === "X" ? ` (${xLength(text)}/${X_LIMIT})` : "";
    const over = draft.platform === "X" && xLength(text) > X_LIMIT ? " ⚠️ over the X limit" : "";
    await ctx.reply(`Saved your edit to #${draft.id}${count}${over}. Why the change? (/cancel to skip)`);
    return;
  }
  waiting = null;
  await ctx.reply("Turning that into a lesson...");
  void proposeLesson(draft, current.kind === "editReason" ? current.edited : null, text);
});

/** Ask the model for a lesson; returns the four lines, or null if the answer doesn't have them. */
function parseLesson(output: string): string | null {
  const labels = ["Rule", "Applies to", "Why", "From edit"];
  const lines = labels.map((label) => output.match(new RegExp(`^\\**${label}:\\**\\s*(.+)$`, "mi"))?.[1].trim());
  if (lines.some((l) => !l)) return null;
  return removeEmDashes(labels.map((label, i) => `${label}: ${lines[i]}`).join("\n"));
}

async function proposeLesson(draft: DraftRow, edited: string | null, reason: string): Promise<void> {
  const change = edited ? `Owner's edited version:\n${edited}` : "The owner skipped this draft instead of posting it.";
  const prompt = `You turn an owner's feedback on a social post draft into one lesson for future drafts.

Output exactly these four lines and nothing else:
Rule: one short, general instruction that would improve future drafts, not just this one
Applies to: "${draft.platform}" if it's only about ${draft.platform}, otherwise "all posts" or a type of post such as "build updates"
Why: the owner's reason in a few words, first person
From edit: a few words on what was drafted and what the owner ${edited ? "changed" : "skipped"}

Plain text only. No Markdown, no em dashes. Don't repeat an existing lesson; if the feedback matches one, make the rule more specific.

Existing lessons (from ${LESSONS_PATH}):
${readLessons() || "None yet."}

Platform: ${draft.platform}
Original draft:
${draft.text}

${change}

Owner's reason: ${reason}`;

  try {
    let lesson = parseLesson(await generate(prompt));
    if (!lesson) lesson = parseLesson(await generate(prompt));
    if (!lesson) throw new Error("the model's answer didn't have the Rule / Applies to / Why / From edit lines");
    const key = nextLessonKey++;
    proposed.set(key, lesson);
    const keyboard = new InlineKeyboard().text("Save", `ls:${key}`).text("Discard", `ld:${key}`);
    await tell(`Proposed lesson:\n\n${lesson}`, keyboard);
  } catch (err) {
    console.error("Lesson failed:", err);
    await tell(friendlyError(err, "writing the lesson"));
  }
}

// Save / Discard buttons on a proposed lesson.
bot.callbackQuery(/^l([sd]):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const key = Number(ctx.match[2]);
  const lesson = proposed.get(key);
  await removeButtons(ctx);
  if (!lesson) return void (await ctx.reply("That lesson is no longer available (already handled, or the bot restarted)."));
  proposed.delete(key);
  if (ctx.match[1] === "d") return void (await ctx.reply("Discarded."));
  const n = appendLesson(lesson);
  await ctx.reply(`Saved as Lesson ${n} in ${LESSONS_PATH}. New drafts will follow it.`);
});

// Never crash: log and carry on.
bot.catch((err) => console.error(`Bot error: ${errorText(err.error)}`));
process.on("unhandledRejection", (err) => console.error(`Unhandled: ${errorText(err)}`));
process.on("uncaughtException", (err) => console.error(`Uncaught: ${errorText(err)}`));

console.log(ownerId ? `Bot starting. Owner chat: ${ownerId}.` : "Bot starting. No owner yet: send /start from your phone.");
const settings = checkinSettings();
console.log("error" in settings ? `Daily check-in off: ${settings.error}` : `Daily check-in at ${settings.time} Lagos time.`);
const tick = () => void checkinTick().catch((err) => console.error("Check-in failed:", err));
const onStart = (me: { username?: string }) => {
  console.log(`Running as @${me.username}. Ctrl+C to stop.`);
  tick();
  setInterval(tick, 60_000);
};
bot.start({ onStart }).catch((err) => {
  console.error(`Bot stopped: ${errorText(err)}. Check TELEGRAM_BOT_TOKEN and your connection.`);
  process.exit(1);
});
