#!/bin/sh
set -eu
cd "$HOME/evd-patch-r4-validation"
mkdir -p temp
EXPECTED=42b608713dd4cae08e736cd0ee204e024be6cdeb3dafb3d2d9b7baf47f96433f
ACTUAL=$(shasum -a 256 "$HOME/evd-patch-r3-validation/released-5.0.dmg" | cut -d ' ' -f 1)
test "$ACTUAL" = "$EXPECTED"
hdiutil attach -readonly -nobrowse -mountpoint "$PWD/released" "$HOME/evd-patch-r3-validation/released-5.0.dmg" > temp/mount.txt
trap 'hdiutil detach "$PWD/released" >/dev/null' EXIT
EVD_PATCH_APP_ROOT=$(find "$PWD/released" -name app.asar -print -quit)
export EVD_PATCH_APP_ROOT
test -n "$EVD_PATCH_APP_ROOT"
if [ ! -e node_modules ]; then ln -s "$HOME/Projects/VideoDuzenle3/node_modules" node_modules; fi
unset ELECTRON_RUN_AS_NODE
"$HOME/Projects/VideoDuzenle3/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" src/test/patch-r4-electron-smoke.cjs >temp/mac-smoke-stdout.txt 2>temp/mac-smoke-stderr.txt
cat temp/patch-r4-smoke.json
ELECTRON_RUN_AS_NODE=1 "$HOME/Projects/VideoDuzenle3/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" src/test/patch-r4-package.test.cjs
