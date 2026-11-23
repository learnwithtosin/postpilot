// Text helpers that are checked in code, not left to the LLM.

export const X_LIMIT = 280;
const X_URL_LENGTH = 23;

// Code point ranges X counts as 1 character; everything else counts as 2.
const X_SINGLE_WEIGHT: Array<[number, number]> = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
];

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const EMOJI = /\p{Extended_Pictographic}/u;

/** Character count as X counts it: links are 23, emoji and most non-Latin characters are 2. */
export function xLength(text: string): number {
  let length = 0;
  const withoutUrls = text.normalize("NFC").replace(/https?:\/\/\S+/g, () => {
    length += X_URL_LENGTH;
    return "";
  });
  for (const { segment } of graphemes.segment(withoutUrls)) {
    if (EMOJI.test(segment)) {
      length += 2;
      continue;
    }
    for (const char of segment) {
      const code = char.codePointAt(0)!;
      length += X_SINGLE_WEIGHT.some(([lo, hi]) => code >= lo && code <= hi) ? 1 : 2;
    }
  }
  return length;
}

export function emojisIn(text: string): string[] {
  return [...graphemes.segment(text)].map((g) => g.segment).filter((g) => EMOJI.test(g));
}

/**
 * Words, phrases and emojis drafts must never contain (Lessons 4 and 7 in voices/tosin-lessons.md).
 * Matched case-insensitively. Add new entries here.
 */
export const BANNED = ["PostPilot", "🚀", "things got interesting", "one step closer", "interesting feedback loop"];

export function bannedIn(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED.filter((b) => lower.includes(b.toLowerCase()));
}

export const hasEmDash = (text: string): boolean => text.includes("—");

/** Last-resort fix if the model keeps using em dashes. */
export function removeEmDashes(text: string): string {
  return text.replace(/\s*—\s*/g, ", ");
}

/** Lowercase, straight quotes, single spaces: for "does this appear in the samples?" checks. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip code fences or wrapping quotes the model sometimes adds around a post. */
export function cleanModelOutput(text: string): string {
  let out = text.trim().replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();
  if (/^["“].*["”]$/s.test(out)) out = out.slice(1, -1).trim();
  return out;
}
