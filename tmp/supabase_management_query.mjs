import fs from "node:fs/promises";
import path from "node:path";

async function loadToken(repoRoot) {
  const configPath = path.join(repoRoot, ".mcp.codex.local.json");
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = JSON.parse(raw);
  const token = parsed?.mcpServers?.["supabase-dev-codex"]?.args?.[3];
  if (!token) {
    throw new Error("Supabase PAT not found in .mcp.codex.local.json");
  }
  return token;
}

async function main() {
  const [, , projectRef, sqlFile] = process.argv;
  if (!projectRef || !sqlFile) {
    throw new Error("Usage: node tmp/supabase_management_query.mjs <project-ref> <sql-file>");
  }

  const repoRoot = process.cwd();
  const token = await loadToken(repoRoot);
  const query = await fs.readFile(path.resolve(repoRoot, sqlFile), "utf8");

  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase query failed (${response.status}): ${text}`);
  }

  console.log(text);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
