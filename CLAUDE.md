# CLAUDE.md

Working rules for this project.

## Project

This is PostPilot. Read `README.md` and `SPEC.md` before starting any task.

## Scope

- Keep changes small and focused on the task given.
- Ask before adding new dependencies or paid services.

## Git

- Never commit or push until the user replies with "approved, push".
- Then commit with a clear message and push to `origin/main`.
- Never commit secrets. API keys and tokens go in a `.env` file, which must be listed in `.gitignore`. Add a `.env.example` with placeholder values instead.

## After every task

End with a **Review summary** containing:

1. **What changed:** files and why.
2. **Decisions made on my own:** choices not specified in the task.
3. **Unsure about:** anything uncertain or worth double-checking.
4. **How to test:** steps to verify the change.
