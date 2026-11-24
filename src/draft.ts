// npm run draft -- "topic": write one X post and one LinkedIn post in Tosin's voice.
import { draftPosts, hasDayNumber, type Draft, type Platform } from "./drafting.js";
import { friendlyError } from "./llm.js";
import { X_LIMIT, xLength } from "./text.js";

function print(platform: Platform, draft: Draft): void {
  const count = platform === "X" ? ` (${xLength(draft.text)}/${X_LIMIT} characters)` : "";
  console.log(`\n===== ${platform}${count} =====\n`);
  console.log(draft.text);
  for (const flag of draft.flags) console.log(`\n! ${flag}`);
}

async function main(): Promise<void> {
  const topic = process.argv.slice(2).join(" ").trim();
  if (!topic) {
    console.error('Give a topic: npm run draft -- "your topic"');
    process.exit(1);
  }
  if (!hasDayNumber(topic)) {
    console.log('Warning: the topic has no "Day N", so the drafts won\'t include a day number. For a series post, add it: "Day 6 of 30: ..."');
  }
  console.log(`Drafting posts about: ${topic}`);
  const { x, linkedin, notes } = await draftPosts(topic);
  for (const note of notes) console.log(note);
  print("X", x);
  print("LinkedIn", linkedin);
}

main().catch((err: unknown) => {
  console.error(friendlyError(err, "drafting"));
  console.error("\nDetails:", err);
  process.exit(1);
});
