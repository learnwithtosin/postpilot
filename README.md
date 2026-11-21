# PostPilot

PostPilot helps small businesses and indie developers post consistently without sounding like a bot.

## How it works

1. **Teach it your voice.** Give PostPilot 5–10 of your past posts. It builds a voice file that describes how you write.
2. **Get drafts.** PostPilot drafts new posts for X and LinkedIn in your voice.
3. **Approve on Telegram.** Each draft is sent to you on Telegram. Tap **Approve**, **Edit**, or **Skip**.
4. **Post on schedule.** At the times you set, PostPilot sends each approved post to you on Telegram, ready to copy. You post it yourself.

Later, PostPilot will post to X automatically and make short promo videos.

## Status

Pre-development. No app code yet. See [SPEC.md](SPEC.md) for the MVP scope and plan.

## Planned stack

Node.js + TypeScript, a Telegram bot library (grammY), SQLite, and an LLM API for voice learning and drafting. Details in [SPEC.md](SPEC.md#suggested-stack).
