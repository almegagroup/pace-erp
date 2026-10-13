# Branch Workflow (LOCKED 2026-10-13, business owner)

## Branches — only these five exist

| Branch | Who works here |
|---|---|
| `main` | Production. Never committed to directly. |
| `dev` | Integration. Never committed to directly. |
| `agent/claude` | Claude Code |
| `agent/codex` | Codex |
| `agent/chatgpt` | ChatGPT |

No other feature / temporary / experiment branch is created. Each agent works
only on its own `agent/*` branch.

## The one rule: fast-forward only, every time

After every finished piece of work, `main`, `dev` and the local checkout must
point at the exact same commit.

```bash
# 0. Start of every task: bring your agent branch up to main (never stale)
git fetch origin
git checkout agent/<name>
git merge --ff-only origin/main          # fails if the branch diverged -> stop, ask

# 1. Work, run the repo's checks, commit on agent/<name>
git push origin agent/<name>

# 2. Promote: dev, then main — fast-forward only
git fetch origin
git merge-base --is-ancestor origin/main HEAD || { echo "main moved: run step 0 again"; exit 1; }
git push origin HEAD:dev                 # rejected unless it is a fast-forward
git push origin HEAD:main                # rejected unless it is a fast-forward

# 3. Verify — all four SHAs must be identical
git fetch origin
git rev-parse HEAD origin/agent/<name> origin/dev origin/main

# 4. Business owner's own PC (C:\Users\cpalm\Documents\pace-erp)
git checkout main && git pull --ff-only origin main
git checkout dev  && git pull --ff-only origin dev
```

Forbidden: `--force`, `--force-with-lease`, `reset --hard` on a shared branch,
merge commits created only to "make it fit". If a fast-forward is rejected,
another agent promoted first: run step 0 (`merge --ff-only origin/main`) — if
that also fails, the branches diverged and the business owner decides.

Two agents never promote at the same time: finish step 3 before the next
agent starts step 2.

## Archive of branches removed in the 2026-10-13 cleanup

Every one of these was verified to be fully contained in `main`
(`git merge-base --is-ancestor <tip> origin/main` = yes) before deletion, so
no commit was lost. To recover one: `git push origin <sha>:refs/heads/<name>`.

| Former branch | Tip SHA | PR(s) |
|---|---|---|
| `claude/upbeat-mendel-0hbuq9` | `174a81ebdd8e2c0aa595869b08b85304c9c66263` | #645, #648, #651 |
| `codex/bulk-do-reliability` | `0a934ec15307ae4c7e9d2ee15e37f0ef3e189bc3` | #634 |
| `codex/opening-stock-zero-post` | `c3e55c99a6fd813c6dc88d976df805ee22c2f583` | — |
| `codex/restore-grn-migration-version` | `ccd8c6eea88fadb7b18ab256cab45f695b3b2a83` | #636–#643, #652 |
| `feature/ai-core-haiku-smoke-20261012` | `f200ccecd046da9509d1bdaae3772f2476285671` | #644 |
| `feature/ai-core-phase2-mts-contract-20261013` | `210f0d4f12eb2c394da9ff84edf49882c2cab62c` | #647 |
| `feature/mts-planning-phase1-data-foundation-20261013` | `f349881ea6c64e49fd0bc67e7c0057fa0ae5bde9` | #650 |
| `pre-so01-excel-upload` | `5494e688fff7783558e9f028cb4139594527c647` | — (2026-10-08 snapshot) |
