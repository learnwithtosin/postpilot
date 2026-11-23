// npm run draft -- "topic": write one X post and one LinkedIn post in Tosin's voice.
import { generate } from "./llm.js";
import { BANNED, X_LIMIT, bannedIn, cleanModelOutput, hasEmDash, removeEmDashes, xLength } from "./text.js";
import {
  LESSONS_PATH,
  PROFILE_PATH,
  VOICE_PATH,
  formatSamples,
  parseSamples,
  readLessons,
  readProfile,
  readVoiceFile,
  voiceNotes,
  voiceNotesFilled,
} from "./voiceFile.js";

type Platform = "X" | "LinkedIn";

interface Draft {
  text: string;
  flags: string[];
}

const hasDayNumber = (topic: string): boolean => /\bday\s+\d+\b/i.test(topic);

/** The exact opening a series post needs (Lesson 3), e.g. "Day 6 of 30.", or null if the topic has no day. */
function dayPrefix(topic: string): string | null {
  const day = topic.match(/\bday\s+(\d+)\b/i)?.[1];
  return day ? `Day ${day} of 30.` : null;
}

/** Fix a near-miss opening like "Day 6 of 30:" or "day 6 of 30" to the exact prefix. */
function fixDayPrefix(text: string, prefix: string): string {
  const day = prefix.match(/\d+/)![0];
  const nearMiss = new RegExp(`^day\\s+${day}\\s+of\\s+30\\s*[.:,!-]?\\s*`, "i");
  return nearMiss.test(text) ? text.replace(nearMiss, `${prefix} `).trimEnd() : text;
}

/**
 * Lessons that apply to this platform: ones whose "Applies to" names this platform,
 * or names neither platform (e.g. "all posts", "platform tone", "build updates").
 */
function lessonsFor(platform: Platform, lessons: string): string {
  const mentions = { X: /\bX\b/, LinkedIn: /linkedin/i };
  const other: Platform = platform === "X" ? "LinkedIn" : "X";
  return lessons
    .split(/^(?=### )/m)
    .map((block) => block.trim())
    .filter((block) => {
      const appliesTo = block.match(/^Applies to:(.*)$/m)?.[1] ?? "";
      return mentions[platform].test(appliesTo) || !mentions[other].test(appliesTo);
    })
    .join("\n\n");
}

function buildPrompt(platform: Platform, topic: string, context: string, lessons: string): string {
  const format =
    platform === "X"
      ? `one X post (a single post, not a thread) of at most ${X_LIMIT} characters. Links count as 23 characters and each emoji as 2. Aim for well under the limit.`
      : "one LinkedIn post. Use the LinkedIn samples for length, line breaks and hashtag habits.";
  return `You write social posts for Tosin, in Tosin's own voice.

Write ${format}

Topic: ${topic}

Rules:
- Sound like the sample posts and voice notes: same tone, sentence length, words, emoji habits, openings and endings. Don't copy spelling mistakes.
- Follow every lesson listed below. Lessons override everything else here: the samples, the voice notes and the profile. For example, if a lesson says not to name something that the profile mentions, don't name it.
- This post is for ${platform}. Where a lesson gives different rules for X and LinkedIn (such as tone), follow only the ${platform} part, even if the samples or voice notes suggest otherwise.
- Personal facts about Tosin (job, employer, location, age, experience, projects) come only from the profile below. Never take them from the sample posts; those are old and only show how Tosin writes.
- Other facts come only from the topic. Don't invent numbers, names, links, quotes or results.
- Never use em dashes (—).
- Never use any of these: ${BANNED.map((b) => `"${b}"`).join(", ")}.${
    hasDayNumber(topic)
      ? `\n- Start the post with exactly "${dayPrefix(topic)}" (with the full stop), then the rest of the post.`
      : '\n- The topic has no day number. Don\'t start with "Day N of 30" and don\'t guess a day number.'
  }
- Output only the post text. No title, no quotes around it, no notes.

Lessons for ${platform} (from ${LESSONS_PATH}):
${lessons || "None yet."}

${context}`;
}

async function writePost(platform: Platform, topic: string, context: string, allLessons: string): Promise<Draft> {
  const prompt = buildPrompt(platform, topic, context, lessonsFor(platform, allLessons));
  let text = cleanModelOutput(await generate(prompt));
  const prefix = dayPrefix(topic);

  const problems = (t: string): string[] => {
    const found: string[] = [];
    if (prefix && !t.startsWith(prefix)) found.push(`doesn't start with exactly "${prefix}"`);
    if (platform === "X" && xLength(t) > X_LIMIT) found.push(`${xLength(t)} characters, over the ${X_LIMIT} limit`);
    if (hasEmDash(t)) found.push("contains em dashes");
    const banned = bannedIn(t);
    if (banned.length) found.push(`contains banned ${banned.map((b) => `"${b}"`).join(", ")}`);
    return found;
  };

  const firstTry = problems(text);
  if (firstTry.length) {
    console.log(`${platform} draft: ${firstTry.join(" and ")}. Retrying once...`);
    const fix =
      `${prompt}\n\nYour previous draft had a problem: ${firstTry.join(" and ")}. ` +
      `Rewrite it to fix that, keeping the voice.\n\nPrevious draft:\n${text}`;
    text = cleanModelOutput(await generate(fix));
  }

  const flags: string[] = [];
  if (prefix && !text.startsWith(prefix)) {
    const fixed = fixDayPrefix(text, prefix);
    if (fixed.startsWith(prefix)) {
      text = fixed;
      flags.push(`The opening was still wrong after the retry, so it was changed to "${prefix}". Check the first line.`);
    } else {
      flags.push(`DAY: doesn't start with "${prefix}" after one retry. Add it before posting.`);
    }
  }
  if (hasEmDash(text)) {
    text = removeEmDashes(text);
    flags.push("Em dashes were still there after the retry, so they were replaced with commas. Check the wording.");
  }
  const banned = bannedIn(text);
  if (banned.length) {
    flags.push(`BANNED: still contains ${banned.map((b) => `"${b}"`).join(", ")} after one retry. Edit before posting.`);
  }
  if (platform === "X" && xLength(text) > X_LIMIT) {
    flags.push(`OVER LIMIT: ${xLength(text)}/${X_LIMIT} characters after one retry. Shorten it before posting.`);
  }
  return { text, flags };
}

function print(platform: Platform, draft: Draft): void {
  const count = platform === "X" ? ` (${xLength(draft.text)}/${X_LIMIT} characters)` : "";
  console.log(`\n===== ${platform}${count} =====\n`);
  console.log(draft.text);
  for (const flag of draft.flags) console.log(`\n! ${flag}`);
}

async function main(): Promise<void> {
  const topic = process.argv.slice(2).join(" ").trim();
  if (!topic) throw new Error('Give a topic: npm run draft -- "your topic"');
  if (!hasDayNumber(topic)) {
    console.log('Warning: the topic has no "Day N", so the drafts won\'t include a day number. For a series post, add it: "Day 6 of 30: ..."');
  }

  const file = readVoiceFile();
  const samples = parseSamples(file);
  if (!samples.length) throw new Error(`No sample posts found in ${VOICE_PATH}.`);
  if (!voiceNotesFilled(file)) {
    console.log(`Note: the Voice notes in ${VOICE_PATH} are empty. Run "npm run voice" for better drafts.`);
  }
  const lessons = readLessons();
  const profile = readProfile();
  if (!profile) console.log(`Note: ${PROFILE_PATH} is missing or empty. Drafts won't mention personal facts.`);

  const context = [
    `Profile (from ${PROFILE_PATH}, the only source of personal facts):\n${profile || "None. Don't state any personal facts."}`,
    voiceNotesFilled(file) ? `Voice notes:\n${voiceNotes(file)}` : "",
    `Sample posts:\n${formatSamples(samples)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  console.log(`Drafting posts about: ${topic}`);
  const [x, linkedin] = await Promise.all([
    writePost("X", topic, context, lessons),
    writePost("LinkedIn", topic, context, lessons),
  ]);
  print("X", x);
  print("LinkedIn", linkedin);
}

main().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
