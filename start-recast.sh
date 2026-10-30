#!/bin/sh
set -eu
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo 'Install Node.js 24 or later from https://nodejs.org'; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Node.js 24 or later is required"); process.exit(1); }'
[ -f .env ] || cp .env.example .env
[ -d node_modules ] || npm ci
npm run build
echo 'Use this invitation to create an account:'
npm run invite
echo 'Open http://localhost:3000. Add COMFY_API_KEY to .env to generate.'
npm start
