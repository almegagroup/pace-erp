#!/usr/bin/env bash
# Installs a local git post-commit hook that refreshes docs/ai/ERP-CODEMAP.md in the background after any commit
# that touched code (frontend/src, supabase, scripts). Hooks are not versioned, so each machine runs this once.
set -eu
cd "$(dirname "$0")/.."
HOOK=.git/hooks/post-commit
MARK="# erp-codemap-hook"
touch "$HOOK"; chmod +x "$HOOK"
if grep -q "$MARK" "$HOOK"; then echo "codemap hook already installed"; exit 0; fi
[ -s "$HOOK" ] || printf '#!/usr/bin/env bash\n' > "$HOOK"
cat >> "$HOOK" <<'HOOKEOF'

# erp-codemap-hook
if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -qE '^(frontend/src|supabase|scripts)/'; then
  ( nohup bash scripts/update-codemap.sh >/dev/null 2>&1 & ) >/dev/null 2>&1
fi
HOOKEOF
echo "installed: $HOOK"
