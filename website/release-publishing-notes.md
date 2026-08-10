# EVD Web Sitesi Yayınlama Akışı

## Sorumluluk ayrımı

- Büyük dağıtım dosyaları (`.exe`, taşınabilir `.zip` ve `.dmg`) FTP üzerindeki `downloads/` klasörüne elle yüklenir.
- Web sayfaları, dil sayfaları, `update.json`, `releases.json`, CSS/JavaScript ve kılavuzlar GitHub Actions tarafından otomatik yüklenir.
- Otomatik FTP akışı `downloads/**` yolunu dışlar ve bu klasördeki büyük paketlere dokunmaz.

## Yeni sürüm yayınlama

1. Kurulum, taşınabilir ve Mac paketlerini FTP `downloads/` klasörüne yükleyin.
2. `website/update.json`, `website/releases.json`, yerelleştirilmiş sayfalar ve gerekli kılavuzları güncelleyin.
3. Web dosyalarını GitHub deposunun `main` dalına gönderin.
4. `Deploy Website To FTP` iş akışı otomatik çalışır.
5. GitHub Actions sonucunun başarılı olduğunu ve canlı sitede yeni sürümün göründüğünü doğrulayın.

## Güvenlik ve koruma

FTP bağlantı bilgileri yalnızca GitHub repository secret alanında tutulur:

- `FTP_SERVER`
- `FTP_USERNAME`
- `FTP_PASSWORD`
- `FTP_SERVER_DIR`

Bu değerler kaynak koduna veya yayın dosyalarına yazılmaz. İş akışı yayın öncesinde JSON dosyalarını, beş dilde ana sayfaları ve kılavuz sayfalarını doğrular. `website/downloads/` altında dosya bulunursa yanlışlıkla büyük paket yüklenmesini önlemek için yayın durdurulur.

## Elle yeniden çalıştırma

Otomatik yayın başarısız olursa GitHub deposunda `Actions > Deploy Website To FTP > Run workflow` adımlarıyla iş akışı yeniden başlatılabilir.
