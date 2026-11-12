#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v git >/dev/null || { command -v pkg >/dev/null && pkg install -y git; }
command -v curl >/dev/null || { command -v pkg >/dev/null && pkg install -y curl; }
read -r -p "GitHub username [FahadOom]: " U; U=${U:-FahadOom}
read -r -p "New private repo name [tradebrain-v38-4]: " R; R=${R:-tradebrain-v38-4}
read -r -s -p "GitHub token (repo + workflow, hidden): " T; echo
ASK=$(mktemp); trap 'rm -f "$ASK"; unset TB_TOKEN GIT_ASKPASS GIT_TERMINAL_PROMPT' EXIT
cat > "$ASK" <<'ASK_EOF'
#!/bin/sh
printf '%s\n' "$TB_TOKEN"
ASK_EOF
chmod +x "$ASK"
export TB_TOKEN="$T" GIT_ASKPASS="$ASK" GIT_TERMINAL_PROMPT=0
H=(-H "Authorization: Bearer $T" -H "Accept: application/vnd.github+json")
C=$(curl -s -o /dev/null -w "%{http_code}" "${H[@]}" -X POST https://api.github.com/user/repos -d "{\"name\":\"$R\",\"private\":true,\"description\":\"TradeBrain v38.4 Adaptive Trade Management\"}")
if [ "$C" != "201" ]; then
  echo "Repository creation returned HTTP $C. Nothing was pushed."
  echo "For safety, this script never force-pushes or replaces an existing main branch. Choose a new repo name, or clone your existing repo and merge the v38 changes."
  exit 1
fi
[ -d .git ] || git init -q -b main
git checkout -q -B main
git config user.name "$U"; git config user.email "$U@users.noreply.github.com"
git add -A; git commit -q -m "TradeBrain v38.4: Adaptive Trade Management and Trade Survival" || true
git push -u "https://$U@github.com/$U/$R.git" main
echo "Pushed safely: https://github.com/$U/$R"
echo "Builds: https://github.com/$U/$R/actions"
