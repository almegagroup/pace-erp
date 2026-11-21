# Agent instructions (Codex, ChatGPT and any other coding agent)

Read `docs/ai/ERP-CODEMAP.md` (auto-generated map of the whole codebase — read it before crawling files) and `CLAUDE.md` (project context, mandatory rules, bug-pattern checklist) and
`docs/BRANCH-WORKFLOW.md` before starting.

Branch rule (business owner, 2026-10-13): work only on your own branch —
Codex on `agent/codex`, ChatGPT on `agent/chatgpt`. Never create another
branch. After each finished task promote with fast-forward only:
your branch -> `dev` -> `main`, then confirm your branch, `origin/dev` and
`origin/main` are the same SHA. Never force-push or reset a shared branch.
