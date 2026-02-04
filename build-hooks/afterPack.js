// build-hooks/afterPack.js
const path = require("path");
const { execFileSync } = require("child_process");

function run(cmd, args, cwd) {
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  // Electron-builder'ın ürettiği .app yolu
  // productFilename genelde "Engelsiz Video Düzenleyicisi" gibi olur
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  console.log("[afterPack] App path:", appPath);

  // 1) Tam bundle ad-hoc imza (kaynakları da mühürler)
  // --deep: iç içe framework/helper'ları da alır
  // --force: varsa eskisini overwrite
  // --sign - : ad-hoc
  run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath], context.appOutDir);

  // 2) Verify (CI’da hemen patlasın diye)
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=4", appPath], context.appOutDir);

  // 3) Debug için kısa özet
  run("/usr/bin/codesign", ["-dv", "--verbose=4", appPath], context.appOutDir);

  console.log("[afterPack] codesign ok");
};
