// npm run voice: fill the Voice notes in voices/tosin.md from the sample posts.
// Prints the result and only saves after you confirm.
import { createInterface } from "node:readline/promises";
import { generate } from "./llm.js";
import { emojisIn, normalize } from "./text.js";
import {
  LESSONS_PATH,
  VOICE_HEADINGS,
  VOICE_PATH,
  formatSamples,
  isCasual,
  parseSamples,
  readLessons,
  readVoiceFile,
  voiceNotesFilled,
  writeVoiceNotes,
  type Sample,
} from "./voiceFile.js";

const MIN_SAMPLES = 5;
const NOT_ENOUGH = "- Not enough in the samples to say.";

function wordsPerSentence(text: string): number[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.split(/\s+/).filter((w) => /\w/.test(w)).length)
    .filter((n) => n >= 4); // shorter lines are mostly headings and list labels, not sentences
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function sentenceStats(group: Sample[], label: string): string {
  const lengths = group.flatMap((s) => wordsPerSentence(s.text)).sort((a, b) => a - b);
  if (!lengths.length) return `${label}: no posts`;
  return (
    `${label} (${group.length} posts): sentences usually ${percentile(lengths, 0.25)} to ` +
    `${percentile(lengths, 0.75)} words, median ${percentile(lengths, 0.5)}`
  );
}

/** Patterns across all posts, computed in code so the model doesn't estimate them. */
function measure(samples: Sample[]): string {
  const casual = samples.filter(isCasual);
  const threads = samples.filter((s) => !isCasual(s));

  const emojiPosts = new Map<string, Set<number>>();
  for (const s of samples) {
    for (const e of emojisIn(s.text)) {
      emojiPosts.set(e, (emojiPosts.get(e) ?? new Set()).add(s.number));
    }
  }
  const postsWithEmoji = samples.filter((s) => emojisIn(s.text).length).length;
  const emojiList = [...emojiPosts]
    .sort((a, b) => b[1].size - a[1].size)
    .map(([e, posts]) => {
      const plural = posts.size === 1 ? "" : "s";
      return `${e} in ${posts.size} post${plural} (post${plural} ${[...posts].join(", ")})`;
    })
    .join("; ");
  const postsWithHashtags = samples.filter((s) => /(^|\s)#\w+/.test(s.text)).length;

  return [
    sentenceStats(casual, "Casual posts"),
    sentenceStats(threads, "Explainer threads"),
    `Posts with any emoji: ${postsWithEmoji} of ${samples.length}`,
    `Emojis: ${emojiList || "none"}`,
    `Posts with hashtags: ${postsWithHashtags} of ${samples.length}`,
  ].join("\n");
}

function buildPrompt(samples: Sample[], lessons: string): string {
  // Casual posts first, since they show the natural voice best.
  const ordered = [...samples.filter(isCasual), ...samples.filter((s) => !isCasual(s))];
  return `You are describing how one person writes, based only on their sample posts below.

Describe their voice under exactly these headings, in this order, as Markdown:
${VOICE_HEADINGS.map((h) => `### ${h}`).join("\n")}

Rules:
- Only describe what is actually in the samples. Do not guess, generalise beyond them, or give advice.
- Describe patterns across all posts, not lists of individual posts. Good: "sentences usually 10 to 20 words, longer in explainer threads". Bad: one bullet per post.
- Separate voice from topic. Project names, product names, topic words (e.g. privacy, encryption, blockchain) and project-specific emojis or logos are not voice habits. Describe how they write, not what they write about.
- Don't include personal facts (age, job, location, experience level). Those aren't voice.
- Weight casual posts (single posts and replies) more heavily than long explainer threads. Casual posts show the natural voice; threads are more formal. Mention when a habit only shows up in threads.
- Back points with short quotes from the samples in "double quotes".
- For sentence length and emoji use, use the measurements below. Do not make up your own numbers.
- Follow the lessons below. Don't describe any habit a lesson rules out.
- If the samples don't show something, write "- Not enough in the samples to say."
- Under each heading, write 1 to 4 bullet points starting with "- ".
- "Words I use often": each bullet is - "word or phrase": short note. Only words or phrases that appear in at least 2 different posts and are style, not topic. Skip filler words like "the", "and", "is". Don't add counts.
- "Words I never use": each bullet is - "word": short note. Only words common in generic or AI-written social posts that appear in none of the samples.
- Output only the headings and bullets. No intro, no closing text, no em dashes.

Measurements (computed in code, across all posts):
${measure(samples)}

Lessons (from ${LESSONS_PATH}):
${lessons || "None yet."}

Sample posts (casual posts first, then explainer threads):
${formatSamples(ordered)}`;
}

type Sections = Map<string, string[]>;

function parseSections(output: string): Sections | null {
  const sections: Sections = new Map();
  let current: string[] | null = null;
  for (const line of output.split("\n")) {
    const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (heading) {
      const name = VOICE_HEADINGS.find((h) => h.toLowerCase() === heading[1].toLowerCase());
      current = name ? [] : null;
      if (name) sections.set(name, current!);
    } else if (current && line.trim()) {
      current.push(line.trimEnd());
    }
  }
  return VOICE_HEADINGS.every((h) => sections.has(h)) ? sections : null;
}

const quotesIn = (line: string): string[] =>
  [...normalize(line).matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).filter(Boolean);

function postsContaining(phrase: string, samples: Sample[]): number {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|\\W)${escaped}($|\\W)`);
  return samples.filter((s) => pattern.test(normalize(s.text))).length;
}

/** Drop word claims the samples don't support. Returns warnings for anything removed or unverified. */
function verify(sections: Sections, samples: Sample[]): string[] {
  const warnings: string[] = [];

  const often = sections.get("Words I use often")!;
  sections.set(
    "Words I use often",
    often.flatMap((line) => {
      const word = quotesIn(line)[0];
      const count = word ? postsContaining(word, samples) : 0;
      if (count < 2) {
        warnings.push(`Removed from "Words I use often" (in ${count} posts): ${line}`);
        return [];
      }
      return [`${line} (in ${count} of ${samples.length} posts)`];
    }),
  );

  const never = sections.get("Words I never use")!;
  sections.set(
    "Words I never use",
    never.filter((line) => {
      const word = quotesIn(line)[0];
      const count = word ? postsContaining(word, samples) : -1;
      if (count !== 0) warnings.push(`Removed from "Words I never use" (${count === -1 ? "no quoted word" : `found in ${count} posts`}): ${line}`);
      return count === 0;
    }),
  );

  const allText = normalize(samples.map((s) => s.text).join("\n"));
  for (const heading of VOICE_HEADINGS) {
    if (heading.startsWith("Words")) continue;
    for (const line of sections.get(heading)!) {
      for (const quote of quotesIn(line)) {
        if (!allText.includes(quote)) warnings.push(`Quote not found in samples (${heading}): "${quote}"`);
      }
    }
  }
  return warnings;
}

function render(sections: Sections, sampleCount: number): string {
  const date = new Date().toISOString().slice(0, 10);
  const body = VOICE_HEADINGS.map((h) => {
    const lines = sections.get(h)!;
    return `### ${h}\n\n${(lines.length ? lines : [NOT_ENOUGH]).join("\n")}`;
  }).join("\n\n");
  return `_Generated by \`npm run voice\` from ${sampleCount} sample posts on ${date}. Edit freely._\n\n${body}`;
}

async function main(): Promise<void> {
  const file = readVoiceFile();
  const samples = parseSamples(file);
  if (samples.length < MIN_SAMPLES) {
    throw new Error(`Found ${samples.length} sample posts in ${VOICE_PATH}. Add at least ${MIN_SAMPLES}.`);
  }
  console.log(`Read ${samples.length} sample posts from ${VOICE_PATH}. Asking the model...\n`);

  const prompt = buildPrompt(samples, readLessons());
  let sections = parseSections(await generate(prompt));
  if (!sections) {
    console.log("The model's answer was missing some headings. Retrying once...\n");
    sections = parseSections(await generate(prompt));
  }
  if (!sections) throw new Error("The model's answer was missing some headings twice. Nothing was saved.");

  const warnings = verify(sections, samples);
  const notes = render(sections, samples.length);

  console.log("## Voice notes (preview)\n");
  console.log(notes);
  if (warnings.length) {
    console.log("\nChecks:");
    for (const w of warnings) console.log(`  ! ${w}`);
  }

  const replacing = voiceNotesFilled(file) ? " This replaces the current Voice notes." : "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nSave to ${VOICE_PATH}?${replacing} (y/N) `);
  rl.close();

  if (answer.trim().toLowerCase() === "y") {
    writeVoiceNotes(file, notes);
    console.log(`Saved. Only the Voice notes section of ${VOICE_PATH} changed.`);
  } else {
    console.log("Not saved.");
  }
}

main().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
