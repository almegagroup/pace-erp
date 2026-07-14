# Codex Supabase MCP Setup

This setup is separate from Claude's existing `.mcp.json`.

## Files added for Codex

- `.mcp.codex.example.json` — copyable MCP template for Codex
- `.mcp.codex.local.json` — local Codex MCP file already created for you; gitignored

## What token you need

Create a Supabase Personal Access Token from:

- Supabase Dashboard
- Account
- Access Tokens

Suggested token name:

- `pace-erp-codex-mcp`

Use the DEV-scoped token first. Do not start with PROD.

## Local setup steps

1. Open `.mcp.codex.local.json`.
2. Replace `PASTE_YOUR_SUPABASE_PAT_HERE` with your real Supabase PAT.
3. In Codex MCP settings, add the same server entry from `.mcp.codex.local.json`.
4. Start a fresh Codex session after saving the MCP config.

## Current repo state

The repo is now prepared with:

- a safe tracked template: `.mcp.codex.example.json`
- a ready-to-edit local file: `.mcp.codex.local.json`
- git ignore protection so the PAT does not get committed

## Suggested MCP server entry

```json
{
  "mcpServers": {
    "supabase-dev-codex": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--access-token",
        "YOUR_REAL_SUPABASE_PAT"
      ]
    }
  }
}
```

## Notes

- This does not modify Claude's config.
- Keep PAT out of tracked files.
- If the token is rotated, update only your local Codex MCP config and open a new session.
- MCP access still depends on the current app session loading that config successfully.
