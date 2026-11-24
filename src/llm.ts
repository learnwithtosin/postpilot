// The only place PostPilot talks to an LLM. To switch providers (e.g. Claude),
// change this file and keep the generate(prompt) signature.
import { config } from "dotenv";
import { ApiError, GoogleGenAI } from "@google/genai";

config({ quiet: true });

/** Waits before each retry when the model is busy (503) or rate limited (429). */
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];
const BUSY_STATUSES = [429, 503];
/** v1beta serves "-latest" model aliases (e.g. gemini-flash-lite-latest); v1 doesn't. */
const API_VERSION = "v1beta";

let client: GoogleGenAI | undefined;

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && !value.startsWith("your-") ? value : undefined;
}

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

const isBusy = (err: unknown): boolean => err instanceof ApiError && BUSY_STATUSES.includes(err.status);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callModel(model: string, prompt: string): Promise<string> {
  client ??= new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY"), apiVersion: API_VERSION });
  const response = await client.models.generateContent({ model, contents: prompt });
  const text = response.text?.trim();
  if (!text) throw new Error(`Gemini (${model}) returned an empty response.`);
  return text;
}

export async function generate(prompt: string): Promise<string> {
  const model = requireEnv("GEMINI_MODEL");
  const fallback = readEnv("GEMINI_FALLBACK_MODEL");

  for (let attempt = 0; ; attempt++) {
    try {
      return await callModel(model, prompt);
    } catch (err) {
      if (!isBusy(err)) throw err;
      if (attempt >= RETRY_DELAYS_MS.length) {
        if (!fallback) throw err;
        console.log(`${model} still busy after ${RETRY_DELAYS_MS.length} retries. Trying fallback model ${fallback}...`);
        return await callModel(fallback, prompt);
      }
      console.log("Model busy, retrying...");
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

/**
 * A short, friendly message for an error from generate() (or anything around it).
 * `doing` finishes the fallback message, e.g. "drafting" or "writing the lesson".
 * Log the full error separately; this hides the details.
 */
export function friendlyError(err: unknown, doing = "drafting"): string {
  const status = (err as { status?: unknown } | null)?.status; // ApiError carries the HTTP status
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const KEY = "The Gemini API key isn't working. Check GEMINI_API_KEY in .env.";
  const MODEL = "The AI model name in .env isn't working. Check GEMINI_MODEL.";
  const QUOTA = "I've hit the free usage limit for now. Try again later.";
  const BUSY = "The AI model is busy right now. Try again in a few minutes.";

  if (status === 401 || status === 403) return KEY;
  if (status === 404) return MODEL;
  if (status === 429) return QUOTA;
  if (status === 503) return BUSY;
  if (/gemini_api_key|api key|api_key/.test(msg)) return KEY;
  if (/gemini_model|model.*not found/.test(msg)) return MODEL;
  if (/quota|resource_exhausted|rate limit/.test(msg)) return QUOTA;
  if (/high demand|overloaded|unavailable/.test(msg)) return BUSY;
  return `Something went wrong while ${doing}. Check the terminal for details.`;
}
