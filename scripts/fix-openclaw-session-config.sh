#!/usr/bin/env bash

set -euo pipefail

CONFIG_PATH="${1:-$HOME/.openclaw/openclaw.json}"
DEFAULT_SESSION_KEY="${2:-hook:lms:user:default}"
ALLOWED_PREFIX="${3:-hook:lms:user:}"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required but not installed." >&2
  exit 1
fi

if [ ! -f "$CONFIG_PATH" ]; then
  echo "Error: OpenClaw config not found at $CONFIG_PATH" >&2
  exit 1
fi

TMP_FILE="$(mktemp)"
BACKUP_PATH="${CONFIG_PATH}.bak.$(date +%Y%m%d%H%M%S)"

cp "$CONFIG_PATH" "$BACKUP_PATH"

node - "$CONFIG_PATH" "$TMP_FILE" "$DEFAULT_SESSION_KEY" "$ALLOWED_PREFIX" <<'NODE'
const fs = require('fs');

const [configPath, tmpPath, defaultSessionKey, allowedPrefix] = process.argv.slice(2);
const raw = fs.readFileSync(configPath, 'utf8');
const data = JSON.parse(raw);

if (!data.hooks || typeof data.hooks !== 'object') {
  data.hooks = {};
}

data.hooks.defaultSessionKey = defaultSessionKey;

const existingPrefixes = Array.isArray(data.hooks.allowedSessionKeyPrefixes)
  ? data.hooks.allowedSessionKeyPrefixes.filter(value => typeof value === 'string' && value.trim() !== '')
  : [];

const merged = Array.from(new Set([allowedPrefix, ...existingPrefixes]));
data.hooks.allowedSessionKeyPrefixes = merged;

fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`);
NODE

mv "$TMP_FILE" "$CONFIG_PATH"

echo "Updated: $CONFIG_PATH"
echo "Backup:  $BACKUP_PATH"
echo "defaultSessionKey: $DEFAULT_SESSION_KEY"
echo "allowedSessionKeyPrefixes: $ALLOWED_PREFIX"
echo
echo "Next steps:"
echo "1. Restart OpenClaw: openclaw gateway restart"
echo "2. Check port:       ss -ltnp | grep 18789"
echo "3. Test locally:     curl -v http://127.0.0.1:18789/hooks/agent"
