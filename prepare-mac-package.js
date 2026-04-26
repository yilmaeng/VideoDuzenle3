const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Kaynak ve hedef klasörler
const sourceDir = __dirname;
const targetDirName = 'Mac_Test_Paketi_Guncel_v2';
const targetDir = path.join(sourceDir, targetDirName);

// Oluşturulacak ZIP ismi
const zipName = 'Mac_Test_Paketi_Guncel_v2.zip';
const zipPath = path.join(sourceDir, zipName);

console.log('📦 Mac Test Paketi Hazırlanıyor...');

// 1. Hedef klasörü temizle/oluştur
if (fs.existsSync(targetDir)) {
    console.log('Eski klasör siliniyor...');
    fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir);

// 2. Kopyalanacak dosya ve klasörler
const itemsToCopy = [
    'src',
    'package.json',
    'start.sh',
    'start-debug.sh',
    'setup-mac.sh',
    'README.md',
    'MAC-KURULUM.md' // Varsa
];

// Dosya kopyalama fonksiyonu (Recursive)
function copyRecursiveSync(src, dest) {
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest);
        }
        fs.readdirSync(src).forEach((childItemName) => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

console.log('📂 Dosyalar kopyalanıyor...');

itemsToCopy.forEach(item => {
    const srcPath = path.join(sourceDir, item);
    const destPath = path.join(targetDir, item);

    if (fs.existsSync(srcPath)) {
        console.log(`   - ${item}`);
        copyRecursiveSync(srcPath, destPath);
    } else {
        console.warn(`⚠️  Uyarı: ${item} bulunamadı!`);
    }
});

// 3. ZIP oluştur (PowerShell kullanarak - Windows ortamında olduğumuz için)
/*
console.log('🗜️  ZIP dosyası oluşturuluyor...');

// Varsa eski zip'i sil
if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
}

try {
    // Compress-Archive komutu
    const psCommand = `Compress-Archive -Path "${targetDir}\\*" -DestinationPath "${zipPath}" -Force`;
    execSync(`powershell -Command "${psCommand}"`, { stdio: 'inherit' });

    console.log('');
    console.log('✅ PAKET HAZIR!');
    console.log(`📁 Klasör: ${targetDir}`);
    console.log(`📦 ZIP:    ${zipPath}`);
    console.log('');
    console.log('Bu ZIP dosyasını Mac kullanıcısına gönderebilirsiniz.');
} catch (error) {
    console.error('❌ ZIP oluşturma hatası:', error.message);
    console.log('Lütfen manuel olarak şu klasörü zipleyin:', targetDir);
}
*/
console.log('');
console.log('✅ KLASÖR GÜNCELLENDİ!');
console.log(`📁 Klasör: ${targetDir}`);
console.log('ZIP oluşturma adımı kullanıcı isteği üzerine atlandı.');
