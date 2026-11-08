#!/bin/sh
# Bundles the desktop shell to CommonJS (Electron's main process format). Run from the repo root.
set -e
O=packages/app/build
mkdir -p $O
npx esbuild packages/app/electron/main.ts --bundle --platform=node --format=cjs --outfile=$O/main.cjs --external:electron --external:better-sqlite3-multiple-ciphers --external:systeminformation --log-level=warning
npx esbuild packages/app/electron/preload.ts --bundle --platform=node --format=cjs --outfile=$O/preload.cjs --external:electron --log-level=warning
