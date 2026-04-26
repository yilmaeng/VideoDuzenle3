
# GitHub için temiz bir kopya oluşturma scripti
$source = "$PSScriptRoot"
$dest = "$PSScriptRoot\GitHub_Hazirlik"

# Temizle ve yeniden oluştur
if (Test-Path $dest) {
    Remove-Item -Recurse -Force $dest
}
New-Item -ItemType Directory -Path $dest | Out-Null

Write-Host "GitHub için dosyalar hazırlanıyor..." -ForegroundColor Green

# Kopyalanacak dosya ve klasörler
$foldersToCopy = @("src", "resources", "assets", "Geçiş Sesleri", "Animation Sounds", ".github")
$filesToCopy = @("package.json", "package-lock.json", ".gitignore", "README.md", "start.sh", "start.bat", "start-debug.sh", "start-debug.bat", "Start_icon.png", "Start_icon.ico", "entitlements.mac.plist")

# Klasörleri kopyala
foreach ($folder in $foldersToCopy) {
    if (Test-Path "$source\$folder") {
        Copy-Item -Recurse "$source\$folder" "$dest\$folder"
        Write-Host "Kopyalandı: $folder"
    } else {
        Write-Warning "Bulunamadı: $folder"
    }
}

# Dosyaları kopyala
foreach ($file in $filesToCopy) {
    if (Test-Path "$source\$file") {
        Copy-Item "$source\$file" "$dest\$file"
        Write-Host "Kopyalandı: $file"
    } else {
        Write-Warning "Bulunamadı: $file"
    }
}

# Mac için çalıştırma izinlerini ayarla (Windows'ta tam çalışmasa da niyet belli olsun)
# (Bu adım aslında sadece Mac/Linux terminalinde `chmod +x` ile yapılır ama buraya not düşelim)

Write-Host "---------------------------------------------------" -ForegroundColor Cyan
Write-Host "Hazırlık Tamamlandı!" -ForegroundColor Green
Write-Host "Lütfen '$dest' klasörünün içeriğini kopyalayıp," -ForegroundColor Yellow
Write-Host "GitHub deposu olan (EngelsizVideoDuzenleyici2) klasörünün içine yapıştırın ve 'Tümünü Değiştir' deyin." -ForegroundColor Yellow
Write-Host "---------------------------------------------------" -ForegroundColor Cyan
