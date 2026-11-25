# PostPilot

PostPilot helps solo founders, small businesses and indie developers post consistently without sounding like a bot.

## How it works

1. **Teach it your voice.** Give PostPilot 5–10 of your past posts. It builds a voice file that describes how you write.
2. **Get drafts.** PostPilot drafts new posts for X and LinkedIn in your voice.
3. **Approve on Telegram.** Each draft is sent to you on Telegram. Tap **Approve**, **Edit**, or **Skip**.
4. **Post on schedule.** At the times you set, PostPilot sends each approved post to you on Telegram, ready to copy. You post it yourself.

Later, PostPilot will post to X automatically and make short promo videos.

## Status

In development. What works now:

- **Voice file:** `npm run voice` describes your writing style from your sample posts.
- **Drafting:** `npm run draft` (or `/draft` in Telegram) writes an X post and a LinkedIn post in your voice.
- **Telegram approval:** Approve, Edit or Skip each draft from your phone.
- **Lessons:** when you edit or skip a draft, your reason becomes a rule that future drafts follow.
- **Daily check-in:** the bot asks what you worked on each morning and drafts that day's post from your reply.

Not built yet: scheduled delivery of approved posts. See [SPEC.md](SPEC.md) for the MVP scope and plan.

## Running the bot

`npm run bot` starts the Telegram bot. It only works while your laptop is on and `npm run bot` is running: if the laptop is off or asleep, it won't send drafts or the daily check-in. A missed check-in is sent when the bot is next running that day. Running on a small server is planned (see [SPEC.md](SPEC.md#later)).

## Planned stack

Node.js + TypeScript, a Telegram bot library (grammY), SQLite, and an LLM API for voice learning and drafting. Details in [SPEC.md](SPEC.md#suggested-stack).
