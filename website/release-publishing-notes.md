# EVD Web Sitesi Sürüm Yayınlama Notları

## Windows sürümü

Yeni bir Windows sürümü yayımlarken:

1. Kurulum ve portable dosyalarını sunucudaki `downloads/` klasörüne yükleyin.
2. Kök dizindeki `update.json` dosyasını güncelleyin.
3. `releases.json` dosyasında `latestVersion` alanını güncelleyin ve yeni sürümü listenin başına ekleyin.
4. Uygulamadaki Hakkında metninin tüm etkin dillerde doğru sürümü gösterdiğini kontrol edin.

Portable dağıtım, içinde `EVD` klasörü bulunan bir `.zip` dosyasıdır.

## EVD 4.7.0 Mac Public Beta

Mac public beta için hazırlanmış dosya:

- Yerel kaynak: `dist/EVD-4.7.0-arm64.dmg`
- FTP hedefi: `/downloads/EVD-4.7.0-arm64.dmg`
- Mimari: Apple Silicon (`arm64`)
- Dosya boyutu: 263.228.540 bayt (yaklaşık 251,03 MiB)
- SHA-256: `D55084A828502AB09E459A80E4434F3414FD8F9D9A283E6B80F669143C703D28`

Web sitesindeki public beta bölümü, `releases.json` içindeki `macBeta` alanından oluşturulur. Kullanıcıya bu sürümde OBS ve native helper desteğinin henüz bulunmadığı, bu özelliklerin yakında ekleneceği açıkça bildirilir.

FTP yayını sırasında aşağıdaki dosyaları güncelleyin:

- `/index.html`
- `/releases.json`
- `/site.js`
- `/site.css`
- `/tr/index.html`
- `/en/index.html`
- `/de/index.html`
- `/es/index.html`
- `/fr/index.html`
- `/downloads/EVD-4.7.0-arm64.dmg`

`update.json` Windows otomatik güncelleme akışına aittir. Mac public beta yayımlanırken değiştirilmez.

## Yayın sonrası kontrol

1. Her dilde Mac public beta başlığının, uyarının ve indirme bağlantısının göründüğünü kontrol edin.
2. İndirme bağlantısının `EVD-4.7.0-arm64.dmg` dosyasını açtığını doğrulayın.
3. Sunucudaki DMG dosyasının SHA-256 değerini yukarıdaki değerle karşılaştırın.
4. Tarayıcı önbelleğini atlayarak sayfayı yeniden yükleyin ve yeni CSS/JavaScript sürümünün geldiğini doğrulayın.