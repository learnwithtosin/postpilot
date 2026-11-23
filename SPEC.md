# PostPilot — MVP Spec

## Who it's for

**For:** solo founders, small businesses (1 to 20 people) and indie developers who already have a product and post sometimes, but can't stay consistent. They want to sound like themselves, not like AI, and they're happy to approve each post.

**Not for:**
- Businesses with no product or offer yet (build the offer first)
- Brands with a social media team
- Anyone who wants fully automatic posting with no review
- Engagement farming and spam

## User story

> As a small business owner or indie developer, I want an assistant that writes posts in my voice and lets me approve them from my phone, so I can post consistently without spending time writing every day.

**Example:** Ada runs a small SaaS. She pastes 8 of her old X posts into PostPilot. Each morning she gets a Telegram message with a draft post. She taps **Approve** on most, fixes a word on one, skips another. At 10:00 her time, PostPilot sends her the approved post, ready to copy, and she posts it on X.

## MVP features (next 7 days)

### 1. Voice file
- Input: 5–10 past posts (pasted text or a file).
- Sample format (e.g. `voices/tosin.md`): each sample is a `### Post N` heading, then `Platform:` and `Type:` lines, then the post text as plain text straight under `Type:`. Threads are voice samples only; PostPilot doesn't draft threads yet.
- An LLM analyzes them and writes a **voice file**: tone, sentence length, vocabulary, emoji/hashtag habits, topics, and a few example posts.
- Stored as a readable file (Markdown or JSON) the owner can view and edit.
- Can be regenerated when the owner adds more posts.

### 2. Draft generator
- Uses the voice file plus an optional topic or prompt to draft posts.
- Produces drafts for X (within the character limit) and LinkedIn (longer form).
- Saves each draft with a status: `pending`, `approved`, `skipped`, `sent`, `posted`.

### 3. Telegram approval
- The bot sends each draft to the owner with three buttons: **Approve**, **Edit**, **Skip**.
- **Edit:** owner replies with new text; the edited version replaces the draft and is shown again for approval.
- Only the owner's Telegram account can approve (allowlist by chat ID).

### 4. Scheduled delivery for X (manual posting)
- Approved X posts are queued to the next open slot (owner-defined times, e.g. 10:00 and 16:00).
- At each slot, the bot sends the finished post to the owner on Telegram as plain text, ready to copy. The post is marked `sent`.
- The owner posts it on X themselves, then taps **Posted** to mark it `posted`.
- No X API calls in the MVP.

## Out of scope (for this MVP)

- Posting to X or LinkedIn through their APIs (the owner posts by hand)
- Promo video generation
- Web dashboard or UI beyond Telegram
- Multiple users, teams, or accounts
- Images, threads, or polls
- Analytics and engagement tracking
- Billing and sign-up

## Later

- **Automatic posting to X** via the X API v2 (e.g. `twitter-api-v2`), with a Telegram confirmation and post link
- Automatic posting to LinkedIn
- Short promo videos

## Suggested stack

| Area | Choice |
| --- | --- |
| Runtime | Node.js (LTS) + TypeScript |
| Telegram bot | [grammY](https://grammy.dev) (alternative: Telegraf) |
| Database | SQLite via `better-sqlite3` (move to Postgres later if needed) |
| LLM | Gemini for now, Claude later. All calls go through `generate(prompt)` in `src/llm.ts`, so switching means changing one file |
| Scheduler | `node-cron`, or a simple polling loop over the database |
| Config | `.env` file for API keys and the owner's chat ID |

## Open questions

1. **Draft cadence:** how many drafts per day, and does the bot send them on a schedule or on request?
2. **Topics:** where do post ideas come from? Owner prompts, a topic list, product updates, or the AI's choice?
3. **Voice input:** how does the owner supply past posts? Paste into Telegram, upload a file, or pull from X?
4. **LLM choice:** Gemini for now, Claude later. Which Gemini model, what's the cost per draft, and when do we switch?
5. **Time zones:** whose time zone sets the delivery schedule?
6. **Unanswered drafts:** what happens to drafts the owner never responds to? Expire, or remind?
7. **Hosting:** where does the bot run? A small VPS, Fly.io, Railway, or similar?
8. **X API (later):** which X API tier is needed for automatic posting, and what does it cost?
