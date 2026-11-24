// Reads and writes the voice file (voices/<name>.md) and the lessons file.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export const VOICE_PATH = "voices/tosin.md";
export const LESSONS_PATH = "voices/tosin-lessons.md";
export const PROFILE_PATH = "voices/tosin-profile.md";

export const VOICE_HEADINGS = [
  "Tone",
  "Sentence length",
  "Words I use often",
  "Words I never use",
  "Emoji use",
  "How I open posts",
  "How I end posts",
] as const;

const NOTES_START = "## Voice notes";
const SAMPLES_START = "## Sample posts";

export interface Sample {
  number: number;
  platform: string;
  type: string;
  text: string;
}

export function readVoiceFile(): string {
  return readFileSync(VOICE_PATH, "utf8");
}

function sectionBounds(file: string): { notesAt: number; samplesAt: number } {
  const notesAt = file.indexOf(NOTES_START);
  const samplesAt = file.indexOf(SAMPLES_START);
  if (notesAt === -1 || samplesAt === -1 || samplesAt < notesAt) {
    throw new Error(`${VOICE_PATH} needs "${NOTES_START}" followed by "${SAMPLES_START}".`);
  }
  return { notesAt, samplesAt };
}

/** Sample posts with text. Empty slots are skipped. */
export function parseSamples(file: string): Sample[] {
  const { samplesAt } = sectionBounds(file);
  const chunks = file.slice(samplesAt).split(/^### Post (\d+)[ \t]*$/m);
  const samples: Sample[] = [];
  for (let i = 1; i < chunks.length; i += 2) {
    const lines = chunks[i + 1].split("\n");
    let platform = "";
    let type = "";
    const body: string[] = [];
    for (const line of lines) {
      const field = line.match(/^(Platform|Type):\s*(.*)$/);
      if (field && body.every((l) => !l.trim())) {
        const value = field[2].trim().replace(/^\((.*)\)$/, "$1").trim();
        if (field[1] === "Platform") platform = value;
        else type = value;
      } else {
        body.push(line);
      }
    }
    const text = body.join("\n").trim();
    if (text) samples.push({ number: Number(chunks[i]), platform, type, text });
  }
  return samples;
}

/** The Voice notes section body (between the two section headings). */
export function voiceNotes(file: string): string {
  const { notesAt, samplesAt } = sectionBounds(file);
  return file.slice(notesAt + NOTES_START.length, samplesAt).trim();
}

/** True if at least one Voice notes heading has text under it. */
export function voiceNotesFilled(file: string): boolean {
  return voiceNotes(file)
    .split("\n")
    .some((line) => line.trim() && !line.startsWith("### ") && !line.startsWith("_"));
}

/** Replace the Voice notes section, leaving everything else untouched. */
export function writeVoiceNotes(file: string, notes: string): void {
  const { notesAt, samplesAt } = sectionBounds(file);
  const updated = `${file.slice(0, notesAt)}${NOTES_START}\n\n${notes.trim()}\n\n${file.slice(samplesAt)}`;
  writeFileSync(VOICE_PATH, updated);
}

/** Lessons listed under "## Lessons", or "" if there are none yet. */
export function readLessons(): string {
  if (!existsSync(LESSONS_PATH)) return "";
  const file = readFileSync(LESSONS_PATH, "utf8");
  const at = file.indexOf("## Lessons");
  return at === -1 ? "" : file.slice(at + "## Lessons".length).trim();
}

/** Append a lesson body (Rule / Applies to / Why / From edit lines) as the next "### Lesson N". Returns N. */
export function appendLesson(body: string): number {
  const file = existsSync(LESSONS_PATH) ? readFileSync(LESSONS_PATH, "utf8") : "# Lessons\n\n## Lessons\n";
  const numbers = [...file.matchAll(/^### Lesson (\d+)/gm)].map((m) => Number(m[1]));
  const next = Math.max(0, ...numbers) + 1;
  writeFileSync(LESSONS_PATH, `${file.trimEnd()}\n\n### Lesson ${next}\n${body.trim()}\n`);
  return next;
}

/** Current facts about the owner, without the file's heading and intro, or "" if missing. */
export function readProfile(): string {
  if (!existsSync(PROFILE_PATH)) return "";
  return readFileSync(PROFILE_PATH, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .join("\n");
}

/** Threads are long explainers; everything else (single posts, replies) counts as casual. */
export const isCasual = (s: Sample): boolean => !/thread/i.test(s.type);

export function formatSamples(samples: Sample[]): string {
  return samples
    .map((s) => `--- Post ${s.number} (${s.platform || "unknown platform"}, ${s.type || "unknown type"}) ---\n${s.text}`)
    .join("\n\n");
}
