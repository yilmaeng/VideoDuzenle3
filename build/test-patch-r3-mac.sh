#!/bin/sh
set -eu
cd "$HOME/evd-patch-r3-validation"
export EVD_PATCH_APP_ROOT="$(cat temp/mac-app-root.txt)"
unset ELECTRON_RUN_AS_NODE
"$HOME/Projects/VideoDuzenle3/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" src/test/patch-r3-electron-smoke.cjs >temp/mac-smoke-stdout.txt 2>temp/mac-smoke-stderr.txt
cat temp/patch-r3-smoke.json
