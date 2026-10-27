// Local test-release metadata only. Public update feeds are intentionally unchanged.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const lang of ['tr', 'en', 'de', 'es', 'fr']) {
    const file = path.join(root, 'src/locales', `${lang}.json`);
    const text = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(text);
    const old = data.messages.about_detail;
    fs.writeFileSync(file, text.replace(JSON.stringify(old), JSON.stringify(old.replace('5.5.0', '5.7.0'))));
}
const menu = path.join(root, 'src/main/menu.js');
fs.writeFileSync(menu, fs.readFileSync(menu, 'utf8').replace('Version 5.5.0\\n', 'Version 5.7.0\\n'));
