'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const version = '5.5.0';
const extra = {
 tr: 'EVD 5.5, 5.0 sonrasında yayımlanan tüm ara güncellemeleri ve yeni üretim araçlarını bir araya getiriyor.\n\nDeneysel vokal ayırma ile sesin tamamı veya seçili bölümleri üzerinde çalışabilir, vokalsiz sesi, yalnızca vokali ya da ikisini ayrı ayrı dışa aktarabilirsiniz. Gerekli büyük motor kuruluma dahil değildir; ilk kullanımda boyutu bildirilerek onayınızla indirilir. Otomatik ve isteğe bağlı yapay zekâ destekli kırpma aracı; temkinli, dengeli ve sıkı kadraj seçenekleri, kişisel yönergeler ve uygulanmadan incelenebilen öneriler sunar.\n\nYapay zekâ servisleri ve API anahtarları ortak bir menüde toplandı. Birincil servis ve izin verilen yedek servise geçiş ayarlanabilir, desteklenen servislerde model listeleri internetten yenilenebilir. Windows kayıt sihirbazına ses kesilmeleri yaşayanlar için deneysel OBS uyumluluk seçeneği eklendi. Varsayılan olarak kapalıdır; açıldığında tercih hatırlanır.',
 en: 'EVD 5.5 brings together all patches released after 5.0 and new production tools.\n\nExperimental vocal separation can process an entire recording or selected ranges and export the instrumental, vocals, or both separately. The large optional engine is not bundled; its size is shown and permission requested before the first download. Automatic and optional AI-assisted cropping offers cautious, balanced and tight framing, personal instructions and suggestions you can review before applying.\n\nAI services and API keys are grouped in one menu. Choose a primary service, allow fallback to another service, and refresh model lists online where supported. The Windows recording wizard adds an experimental OBS compatibility option for audio dropouts. It is off by default and remembers your choice when enabled.',
 de: 'EVD 5.5 vereint alle seit 5.0 veröffentlichten Patches und neue Produktionswerkzeuge.\n\nDie experimentelle Gesangstrennung verarbeitet ganze Aufnahmen oder ausgewählte Bereiche und exportiert Instrumentalspur, Gesang oder beide getrennt. Die große optionale Engine ist nicht enthalten; vor dem ersten Download werden Größe und Zustimmung abgefragt. Automatischer und optional KI-gestützter Zuschnitt bietet vorsichtige, ausgewogene und enge Bildausschnitte, eigene Anweisungen und vor der Anwendung prüfbare Vorschläge.\n\nKI-Dienste und API-Schlüssel sind in einem Menü zusammengefasst. Primärdienst und erlaubter Ersatzdienst sind wählbar; unterstützte Modelllisten lassen sich online aktualisieren. Der Windows-Aufnahmeassistent enthält eine experimentelle OBS-Kompatibilitätsoption gegen Tonaussetzer. Sie ist standardmäßig aus und speichert die Auswahl.',
 es: 'EVD 5.5 reúne todos los parches publicados después de 5.0 y nuevas herramientas de producción.\n\nLa separación experimental de voz procesa una grabación completa o intervalos seleccionados y exporta el instrumental, la voz o ambos por separado. El motor opcional de gran tamaño no viene incluido: se informa de su tamaño y se pide permiso antes de descargarlo. El recorte automático, con ayuda opcional de IA, ofrece encuadres prudentes, equilibrados y ajustados, instrucciones personales y propuestas revisables antes de aplicarlas.\n\nLos servicios de IA y las claves API se agrupan en un menú. Se puede elegir un servicio principal, permitir otro de respaldo y actualizar las listas de modelos compatibles en línea. El asistente de grabación de Windows incorpora una opción experimental de compatibilidad con OBS para cortes de audio. Está desactivada de forma predeterminada y recuerda la elección.',
 fr: 'EVD 5.5 réunit tous les correctifs publiés depuis la version 5.0 et de nouveaux outils de création.\n\nLa séparation vocale expérimentale traite un enregistrement entier ou des plages sélectionnées et exporte l’accompagnement, la voix ou les deux séparément. Le moteur optionnel volumineux n’est pas inclus : sa taille est annoncée et votre accord est demandé avant le téléchargement. Le recadrage automatique, avec assistance IA facultative, propose des cadrages prudents, équilibrés et serrés, des consignes personnelles et des suggestions vérifiables avant application.\n\nLes services d’IA et les clés API sont regroupés dans un menu. Choisissez le service principal, autorisez un service de secours et actualisez les modèles en ligne lorsque cette fonction est prise en charge. L’assistant d’enregistrement Windows propose une option expérimentale de compatibilité OBS contre les coupures audio. Désactivée par défaut, elle mémorise votre choix.'
};
function read(file) { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
function write(file, data) { fs.writeFileSync(path.join(root, file), JSON.stringify(data, null, 2) + '\n'); }
const notes = {};
const platformNotes = {
 tr: 'Platform notu: Vokal ayırma motorunun hazır indirme paketi şu anda yalnızca Windows x64 için sunulmaktadır; Mac motor paketi henüz hazır değildir.',
 en: 'Platform note: the downloadable vocal-separation engine is currently available only for Windows x64; the Mac engine package is not ready yet.',
 de: 'Plattformhinweis: Die herunterladbare Engine zur Gesangstrennung ist derzeit nur für Windows x64 verfügbar; das Mac-Paket ist noch nicht fertig.',
 es: 'Nota de plataforma: el motor descargable de separación de voz está disponible actualmente solo para Windows x64; el paquete para Mac aún no está listo.',
 fr: 'Note de plateforme : le moteur téléchargeable de séparation vocale est actuellement disponible uniquement pour Windows x64 ; le paquet Mac n’est pas encore prêt.'
};
for (const lang of Object.keys(extra)) {
 const paragraphs = [extra[lang]];
 for (const revision of [3, 4, 5, 6]) paragraphs.push(read(`patches/5.0.0-revision-${revision}/notes.json`)[lang]);
 notes[lang] = [...paragraphs, platformNotes[lang]].join('\n\n');
 const locale = read(`src/locales/${lang}.json`);
 locale.messages.about_detail = locale.messages.about_detail.replace('5.0.0', version);
 write(`src/locales/${lang}.json`, locale);
}
const pkg = read('package.json'); pkg.version = version; write('package.json', pkg);
const lock = read('package-lock.json'); lock.version = version; lock.packages[''].version = version; write('package-lock.json', lock);
const menu = path.join(root, 'src/main/menu.js');
fs.writeFileSync(menu, fs.readFileSync(menu, 'utf8').replace('Version 5.0.0\\n', `Version ${version}\\n`));
for (const file of ['update.json', 'website/update.json']) {
 const metadata = read(file);
 metadata.version = version; metadata.releaseNotes = notes;
 for (const key of ['setupUrl', 'portableUrl', 'macUrl']) if (metadata[key]) metadata[key] = metadata[key].replaceAll('5.0.0', version);
 write(file, metadata);
}
const releases = read('website/releases.json');
const entry = structuredClone(releases.releases.find(r => r.version === '5.0.0'));
entry.version = version; entry.date = '2026-10-19'; entry.notes = notes;
for (const lang of Object.keys(extra)) entry.title[lang] = 'EVD 5.5';
for (const key of ['setupUrl', 'portableUrl', 'macUrl']) entry[key] = entry[key].replaceAll('5.0.0', version);
releases.latestVersion = version;
releases.releases = [entry, ...releases.releases.filter(r => r.version !== version)];
write('website/releases.json', releases);
for (const file of ['download.html', ...Object.keys(extra).map(l => `${l}/index.html`)]) {
 const target = path.join(root, 'website', file);
 fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replaceAll('5.0.0', version).replaceAll('EVD 5.0', 'EVD 5.5').replaceAll('EVD-5.0-', 'EVD-5.5-'));
}
fs.mkdirSync(path.join(root, 'docs/releases'), {recursive:true});
write('docs/releases/5.5.0-notes.json', notes);
console.log('Prepared 5.5.0 metadata in five languages. No files uploaded.');
