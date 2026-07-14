# EVD macOS Kurtarma Raporu — Temmuz 2026

**Tarih:** 11-12 Temmuz 2026
**Platform:** macOS 27.0 (build 26A5378j, çok yeni/beta bir sürüm) — Apple Silicon
**Sonuç:** ✅ Uygulama imzalı, notarize edilmiş, çalışan bir DMG olarak GitHub Release'de yayında.

Bu belge, EVD'nin macOS'ta çalışan bir build'e kavuşana kadar geçirdiği süreci, karşılaşılan **üç ayrı gerçek hatayı** ve her birinin **kesin çözümünü** ayrıntılı olarak anlatır. Amaç, ileride benzer bir sorun çıkarsa (ya da başka bir Electron projesinde aynı desenle karşılaşılırsa) buradan hızlıca yol bulabilmek.

---

## Özet Tablosu

| # | Sorun | Belirti | Kök Neden | Çözüm |
|---|---|---|---|---|
| 1 | **Açılışta anında çökme** | `SIGTRAP` / `EXC_BREAKPOINT`, exit code 133 | Ürün adındaki "ü" harfi dosya adlarına **NFD** (ayrıştırılmış Unicode) formunda yazılıyordu; bu macOS'un kod imzası güven doğrulaması NFD adlı çalıştırılabilirleri reddediyor | `productName`'i ASCII yaptık, Türkçe görünen adı `CFBundleDisplayName` ile ayrı tuttuk |
| 2 | **Asar bütünlük hash'i yanlış** | Electron'un `ElectronAsarIntegrity` kontrolü teorik olarak tetiklenebilirdi | electron-builder, `app.asar` dosyası son haline gelmeden hash'i hesaplıyordu | `afterPack` script'i ile doğru hash'i imzalamadan hemen önce yeniden hesaplayıp yazdık |
| 3 | **İmzasız/notarize edilmemiş uygulama** | Gerçek Developer ID sertifikası olmadan hiçbir imzalama yöntemi (ad-hoc, entitlements, hardened runtime) çalışmıyordu | Bu macOS sürümü artık yerel çalıştırmada bile gerçek Apple notarization istiyor | Developer ID Application sertifikası + App Store Connect API Key ile tam imzalama + notarization + staple akışı kuruldu |

Ayrıca, **klavye kısayollarının Mac'te hep "Ctrl" göstermesi** (aslında çoğu doğru çalışıyordu, sadece görünen metin yanlıştı) ayrı bir bulgu olarak tespit edilip düzeltildi — bkz. [Bölüm 6](#6-klavye-kısayolu-gösterim-hataları).

---

## 1. Başlangıç Durumu

Repo klonlandığında:
- `npm install` ve `npm run build:mac` çalışıyordu, `.app` üretiliyordu.
- Ama üretilen paket **her zaman, anında çöküyordu** — terminalden direkt çalıştırıldığında bile, hiçbir hata mesajı vermeden `SIGTRAP` (`Trace/BPT trap: 5`, exit code 133) ile sonlanıyordu.
- Geliştirici modu (`electron .` / `npm start`) ise **sorunsuz çalışıyordu** — bu, sorunun uygulama kodunda değil, **paketleme (packaging) adımında** olduğunu gösteriyordu.
- Reponun kendi eski raporu (`Engelsiz-Video-Duzenleyici-macOS-Build-Raporu.md`), bunun bilinen bir "imzasız Apple Silicon uygulaması çalışmıyor" sorunu olduğunu ve çözümün Developer ID sertifikası olduğunu öne sürüyordu. **Bu teşhis kısmen doğruydu ama eksikti** — gerçek sertifika ve notarization ile bile, altta yatan asıl neden (Bölüm 2) çözülmeden uygulama çalışmadı.

---

## 2. Ana Çökme Nedeni: Unicode Normalizasyon Uyuşmazlığı (NFD/NFC)

### 2.1 Teşhis Süreci — Elenen İhtimaller

Çökmenin gerçek nedenini bulmak için, her biri ayrı ayrı test edilip **elenen** çok sayıda ihtimal oldu. Bunların hepsi tek tek doğrulandı:

1. **Ad-hoc imzalama** (`codesign --sign -`) → çöküyor
2. **Ad-hoc + `entitlements.mac.plist`** (JIT izinleri dahil) uygulanmış hali → çöküyor
3. **Ad-hoc + Hardened Runtime + entitlements** → çöküyor
4. **Gerçek Developer ID sertifikasıyla imzalama** (notarization olmadan) → çöküyor
5. **Gerçek Developer ID + Hardened Runtime + entitlements + tam notarization + staple + Gatekeeper "accepted"** → **hâlâ çöküyor** (bu noktada imza/notarization'ın sorun olmadığı kesinleşti)
6. **GPU devre dışı** (`--disable-gpu`) → çöküyor
7. **Sandbox devre dışı** (`--no-sandbox`) → çöküyor
8. **`asar: false`** (paketleme kapalı) → çöküyor
9. **Electron 28.3.3 → 43.1.0 güncellemesi** → çöküyor (Electron/macOS sürüm uyumsuzluğu ihtimali elendi)
10. **Bu ortamda sade bir Electron uygulaması** (pencere açan minimal bir test) → **sorunsuz çalıştı** (ortamın/sandbox'ın kendisi suçlu değildi)
11. **Uygulama içeriğini, hiç değiştirilmemiş orijinal `Electron.app` çalıştırılabilir dosyasının içine kopyalayıp çalıştırma** → **çalıştı** (asıl uygulama kodu suçlu değildi; sorun **yeniden paketleme** adımındaydı)
12. **Sadece çalıştırılabilir dosyayı yeniden adlandırma** (`Electron` → ürün adı, varsayılan içerikle) → **çalıştı** (yeniden adlandırmanın kendisi tek başına suçlu değildi)
13. **Tam yeniden adlandırma (ana + tüm Helper uygulamaları) + gerçek uygulama içeriği, ama saf (electron-builder'ın işlemediği) Electron Framework ile** → **çalıştı**
14. **electron-builder'ın gerçek işlediği Framework'ü bu çalışan kurulumun içine takma** → **yine çalıştı** (Framework'ün kendisi de suçlu değildi)
15. **`ElectronAsarIntegrity` hash uyuşmazlığı bulundu ve düzeltildi** (bkz. Bölüm 3) → hash doğru hale geldi ama **hâlâ çöküyordu** — bu gerçek bir hataydı ama SIGTRAP'in nedeni değildi
16. **Electron "Fuses" (özellik anahtarları) karşılaştırması** → çalışan ve çöken sürümlerde birebir aynıydı, fark yok

Bu noktada, elle bir araya getirilen (electron-builder'ın **hiçbir** adımını atlamayan) parça parça testler bile çalışırken, electron-builder'ın **gerçek, uçtan uca ürettiği** paket hâlâ çöküyordu. Bu, iki "aynı görünen" ama farklı davranan çıktı arasında **byte düzeyinde** bir fark olduğu anlamına geliyordu.

### 2.2 Kesin Kök Neden

**Ürün adı** (`productName` / `CFBundleDisplayName`) `"Engelsiz Video Düzenleyicisi"` idi — içinde Türkçe **"ü"** harfi var. electron-builder, bu adı dosya ve klasör adlarına (çalıştırılabilir dosya adı, `.app` klasör adı, Helper uygulama adları) yazarken, "ü" karakterini **NFD (Normalization Form Decomposed)** biçiminde kodluyordu: yani tek bir "ü" karakteri yerine, `u` harfi + ayrı bir "birleştirici çift nokta" (combining diaeresis) Unicode karakteri olarak, **iki ayrı code point** halinde.

Görsel olarak ekranda **aynı** görünse de, `"ü"` (NFC, tek code point: `U+00FC`) ile `"u" + ◌̈` (NFD, iki code point: `U+0075 U+0308`) **byte düzeyinde tamamen farklı** dizilerdir.

Bu makinedeki çok yeni macOS sürümü (Darwin 27 / "macOS 27.0", muhtemelen bir beta/ileri sürüm), çalıştırılabilir dosyaların kod imzası güvenini doğrularken artık daha katı bir mekanizma kullanıyor (crash raporlarında `codeSigningMonitor` ve `codeSigningTrustLevel` alanlarıyla görülen, Apple'ın yeni "Code Signing Monitor" özelliği). Bu mekanizma, **dosya yolunda NFD-kodlanmış karakterler bulunan çalıştırılabilirleri**, imza kriptografik olarak tamamen geçerli olsa bile, **çekirdek seviyesinde reddedip `SIGTRAP` ile sonlandırıyor**.

Bunun neden sadece electron-builder'ın çıktısında olup, elle yapılan testlerde olmadığı şu şekilde açıklanıyor: elle yapılan testlerde dosya adlandırması `cp`/`mv`/`plutil` gibi standart Unix araçlarıyla yapıldığında, macOS'un dosya sistemi katmanı genelde NFC'yi koruyordu; ama electron-builder'ın kendi iç dosya kopyalama/paketleme mantığı (Node.js tabanlı, `fs` modülü üzerinden) Unicode normalizasyonunu farklı bir noktada, NFD sonucu üreten bir şekilde yapıyordu.

### 2.3 Başarısız İlk Çözüm Denemesi

İlk denenen çözüm, paketleme sonrası (`afterPack` script'i içinde) dosya adlarını NFD'den NFC'ye **geri çeviren** bir düzeltme eklemekti. Bu denendiğinde derleme şu hatayla **başarısız oldu**:

```
a sealed resource is missing or invalid
In subcomponent: .../Engelsiz Video Düzenleyicisi.app/Contents/Frameworks/Engelsiz Video Düzenleyicisi Helper.app
```

Çünkü `codesign`, paketleme sırasında dosya adlarını (byte düzeyinde) imzanın bir parçası olarak **mühürlüyor** (seals); paketleme SONRASI dosya adını değiştirmek bu mührü bozuyor ve imza doğrulamasını başarısız kılıyor. Yani "adı NFC'ye çevir" fikri doğruydu ama **yanlış zamanda** uygulanıyordu ve pratikte electron-builder'ın kendi iç süreciyle güvenli şekilde uyuşmuyordu.

### 2.4 Kesin ve Kalıcı Çözüm

Sorunu kökünden çözen yaklaşım, **hiç Unicode normalizasyon belirsizliği doğurmamaktı**: `package.json`'daki `productName` değeri **düz ASCII** yapıldı:

```diff
- "productName": "Engelsiz Video Düzenleyicisi",
+ "productName": "Engelsiz Video Duzenleyicisi",
```

Bu, çalıştırılabilir dosya adını, `.app` klasör adını ve tüm Helper uygulama adlarını NFD/NFC ayrımı hiç söz konusu olmayan sade ASCII karakterlere indirdi.

Kullanıcının Finder'da, Dock'ta ve "Hakkında" ekranında gördüğü **Türkçe adın kaybolmaması** için, `mac.extendInfo` üzerinden `CFBundleDisplayName` ayrıca Türkçe olarak ayarlandı:

```json
"mac": {
  ...
  "extendInfo": {
    "CFBundleDisplayName": "Engelsiz Video Düzenleyicisi"
  }
}
```

`CFBundleDisplayName`, bir **dosya yolu değil**, sadece `Info.plist` içinde bir metin değeridir — bu yüzden içinde "ü" olması hiçbir normalizasyon sorunu yaratmaz; sadece kullanıcıya gösterilen metni etkiler.

**Doğrulama:** Bu değişiklikle alınan build, gerçek Developer ID sertifikasıyla imzalanıp Apple tarafından notarize edildikten, ticket'ı staple edildikten ve Gatekeeper tarafından "Notarized Developer ID" olarak kabul edildikten sonra, hem doğrudan terminalden hem de Finder/`open` üzerinden **sorunsuz açıldı** — ilk kez.

---

## 3. İkinci Hata: Asar Bütünlük (Integrity) Hash Uyuşmazlığı

Kök neden aranırken, yolda **ayrı, gerçek bir hata** daha bulundu (bu, çökmenin asıl nedeni değildi ama düzeltilmesi gereken gerçek bir bug'dı):

Electron, `Info.plist` içine gömülü bir `ElectronAsarIntegrity` alanıyla `app.asar` dosyasının SHA-256 hash'ini tutar ve açılışta bu hash'i doğrular (kurcalamaya karşı bir güvenlik önlemi). electron-builder'ın kullandığı sürüm, bu hash'i **`app.asar` dosyası son haline gelmeden önceki bir anda** hesaplıyor, bu yüzden gömülü hash ile gerçek dosyanın hash'i **uyuşmuyordu**:

```
Gömülü (yanlış): 65ee79b0a6c0f56868cc7d11c9a5acb4665c90650f51ff5f8cfce431fd8da03c
Gerçek dosya:    be605f74329c38646119052ddd5b9174ac24522ac3a4b5d5eda7b46b3f1a058b
```

**Çözüm:** [`build/afterPackFixes.js`](build/afterPackFixes.js) adında bir `afterPack` script'i eklendi. Bu script, electron-builder'ın paketleme adımı bitip **imzalama başlamadan hemen önce** çalışır; gerçek `app.asar` dosyasının SHA-256 hash'ini yeniden hesaplayıp `Info.plist`'e doğru değerle yazar. Böylece:
- Bütünlük doğrulaması **kapatılmadı** (güvenlik özelliği korundu),
- Sadece electron-builder'ın hatalı hesapladığı değer, imzalanmadan hemen önce doğru değerle değiştirildi.

Bu düzeltme, imzalamadan ÖNCE (Bölüm 2.3'teki hatadan öğrenilen dersle) yapıldığı için, `codesign`'ın mühürlediği son hâl zaten doğru hash'i içeriyor — imza bütünlüğü bozulmuyor.

---

## 4. Developer ID Sertifikası ve Notarization Kurulumu

Unicode sorunu çözülmeden önce de, çözüldükten sonra da, **gerçek dağıtım için** (kullanıcıların "geliştirici doğrulanamadı" uyarısı almadan uygulamayı açabilmesi için) uygun bir imzalama zinciri kurmak gerekiyordu.

### 4.1 Sertifika Oluşturma
1. Bu makinede bir CSR (Certificate Signing Request) ve özel anahtar çifti oluşturuldu (`openssl`), özel anahtar doğrudan kullanıcının giriş Keychain'ine eklendi.
2. `developer.apple.com/account/resources/certificates` üzerinden **"Developer ID Application"** sertifikası, bu CSR yüklenerek oluşturuldu.
3. İndirilen `.cer` dosyası Keychain'e aktarılıp özel anahtarla eşleştirildi → **"Developer ID Application: Omer Yesiltas (3J9URZWHNU)"** kimliği elde edildi.

### 4.2 package.json Yapılandırması

```json
"mac": {
  "hardenedRuntime": true,
  "gatekeeperAssess": false,
  "identity": "Omer Yesiltas (3J9URZWHNU)",
  "entitlements": "entitlements.mac.plist",
  "entitlementsInherit": "entitlements.mac.plist"
}
```

Eski `afterPackMacSign.js` (sadece ad-hoc imzalayan script) kaldırıldı — artık electron-builder, doğru kimlikle **gerçek** imzalamayı kendisi yapıyor.

### 4.3 Notarization Kimlik Bilgileri (App Store Connect API Key)

Apple ID şifresi paylaşmak yerine, **App Store Connect API Key** yöntemi tercih edildi (daha güvenli, şifre gerektirmez):

1. `appstoreconnect.apple.com/access/integrations/api` → Team Keys → "Developer" yetkili bir anahtar oluşturuldu.
2. İndirilen `.p8` dosyası + **Key ID** (`UPTFDPSJHA`) + **Issuer ID** (`66016620-8ce7-4a4b-883a-538955fd9a00`) elde edildi.
3. Build alırken şu ortam değişkenleri tanımlanarak electron-builder'ın otomatik notarization'ı tetiklenir:

```bash
export APPLE_API_KEY=~/Downloads/AuthKey_UPTFDPSJHA.p8
export APPLE_API_KEY_ID=UPTFDPSJHA
export APPLE_API_ISSUER=66016620-8ce7-4a4b-883a-538955fd9a00
npm run build:mac:dmg
```

### 4.4 Beklenmedik Gecikme: Yeni Hesap Doğrulaması

İlk notarization denemeleri **1,5 saatten uzun süre** "In Progress" durumunda takılı kaldı — hem büyük build hem de 6 KB'lık minik test dosyaları için, hem API Key hem de alternatif app-specific password yöntemiyle bile. Apple'ın sistem durumu sayfası "Developer ID Notary Service"i sorunsuz gösteriyordu.

**Neden:** Apple Developer Program üyeliği çok yakın zamanda (birkaç gün önce) onaylanmıştı. Apple, **yeni kaydolan hesapların ilk notarization gönderimlerini** kötüye kullanımı önlemek amacıyla ek/manuel bir incelemeden geçiriyor — bu tek seferlik bir gecikme. Bir gece bekledikten sonra, aynı hesapla yapılan tüm gönderimler (eski takılı kalanlar dahil) **"Accepted"** durumuna geçti ve sonraki tüm notarization'lar birkaç dakika içinde tamamlandı.

### 4.5 DMG'nin Ayrıca İmzalanması Gerekliliği

`.app` paketinin notarize edilmesi, içine konduğu **DMG dosyasının kendisini** kapsamaz. DMG'nin de ayrıca:
```bash
codesign --force --sign "Developer ID Application: Omer Yesiltas (3J9URZWHNU)" "dist/....dmg"
xcrun notarytool submit "dist/....dmg" --key ... --key-id ... --issuer ... --wait
xcrun stapler staple "dist/....dmg"
```
adımlarından geçirilmesi gerekti. `npm run build:mac:dmg` electron-builder aracılığıyla bunu byte kısmen otomatik yapsa da, ilk denemede DMG imzasız kaldığı için bu adımlar elle eklendi.

---

## 5. Yardımcı Araçlar / Elektron-Builder Güncellemesi

- **Electron**: `28.3.3` → `43.1.0`
- **electron-builder**: `25.1.8` → `26.15.3`

Bu güncelleme, kök nedenin (Bölüm 2) kendisi değildi (28.3.3 ile de, 43.1.0 ile de aynı şekilde çöküyordu — bu ihtimal Bölüm 2.1, madde 9'da elenmişti) ama modern macOS ile daha iyi uyumluluk ve güvenlik yamaları için gerekliydi ve yapıldı.

---

## 6. Klavye Kısayolu Gösterim Hataları

Çökme sorunu çözüldükten sonra, uygulama içinde ayrı bir **görsel** sorun fark edildi: Mac'te menüler ve yardım ekranları, kısayolları hep **"Ctrl"** olarak gösteriyordu — oysa çoğu kısayol aslında zaten doğru şekilde **Cmd** ile çalışıyordu (renderer'daki `keyboard.js` sistemi `Mod` token'ını platforma göre doğru çözümlüyordu). Sorun sadece **görünen metindeydi**.

### Bulunan ve Düzeltilen Yerler

1. **`src/main/menu.js`** — `getShortcutTokenMap()`, `CmdOrCtrl`/`Cmd`'yi platformdan bağımsız hep `'Ctrl'`e çeviriyordu. Artık `process.platform === 'darwin'` kontrolüyle Mac'te `'Cmd'`/`'Option'` gösteriyor.
2. **`src/renderer/scripts/dialogs.js`, `accessible-recording.js`, `broadcast-room.js`** — üç ayrı dosyada aynı "hep Ctrl'ye çevir" deseni tekrarlanmıştı (muhtemelen kopyala-yapıştır kökenli); global kısayolların (Anlık Sesli Çeviri, Erişilebilir Kayıt, Yayın Odası) hem kaydı hem gösterimi için düzeltildi.
3. **`src/renderer/scripts/keyboard.js`** — `formatBindingForDisplay()` / `getActionShortcutLabel()` adında, binding string'ini platforma uygun metne çeviren merkezi bir yardımcı eklendi.
4. **Başlangıç ekranı** (`"Ctrl+O ile video açın"` gibi metinler) — bunlar `src/locales/*.json` dosyalarında **sabit kodlanmıştı**, dinamik değildi. 5 dilin (tr/en/de/fr/es) ilgili anahtarları `{shortcut}` yer tutucusuna çevrildi; `i18n.js`'e bu anahtarları tanıyıp doğru kısayolu otomatik yerleştiren küçük bir mekanizma eklendi.
5. **`tab-manager.js`** — ekran okuyucu anonsundaki sabit "Ctrl+O"/"Ctrl+N" metni de aynı şekilde düzeltildi (bu, görme engelli kullanıcılar için özellikle önemliydi).

**Not:** Yardım/öğretici ekranlarında hâlâ ~85+ benzer sabit "Ctrl+..." metni var; bunların bir kısmı (kayıt/yayın global kısayolları gibi) **kasıtlı olarak** tüm platformlarda sabit Ctrl kullanıyor, bu yüzden topluca değiştirmek yanlış olurdu — kapsam dışında bırakıldı, ileride tek tek değerlendirilebilir.

---

## 7. GitHub Release ve CI Temizliği

- İmzalı + notarize edilmiş DMG, `gh release create` ile **v4.7.0** etiketiyle GitHub Release'e yüklendi.
- `.github/workflows/build.yml` ("Build All Platforms") ve `.github/workflows/update-tutorials.yml` workflow'larının **otomatik tetiklemeleri kapatıldı**:
  - `build.yml`, her `v*` tag push'unda tetikleniyordu ama Windows script'i eksikti ve Mac izin-düzeltme adımı artık geçerli olmayan bir çıktı yapısı bekliyordu — ayrıca electron-builder'ın "implicit publishing" davranışı, imzasız/notarize edilmemiş bir DMG'yi sessizce release'e ekleme riski taşıyordu.
  - `update-tutorials.yml`, `website/` klasörü repoda olmadığı için **her gün** başarısız oluyor ve hata maili gönderiyordu.
  - İkisi de `workflow_dispatch` ile hâlâ elle tetiklenebilir durumda.

---

## 8. Güncel Durum ve İleride Build Alma

Repo artık şu komutla, tam imzalı + notarize edilmiş bir DMG üretebiliyor:

```bash
export APPLE_API_KEY=~/Downloads/AuthKey_UPTFDPSJHA.p8   # veya güncel konumu
export APPLE_API_KEY_ID=UPTFDPSJHA
export APPLE_API_ISSUER=66016620-8ce7-4a4b-883a-538955fd9a00
npm run build:mac:dmg
# Sonra DMG'yi ayrıca imzala + notarize et + staple et (bkz. Bölüm 4.5)
```

**Dikkat edilmesi gereken tek şey:** `package.json`'daki `productName` alanı **kesinlikle ASCII kalmalı** (aksanlı/Türkçe karakter içermemeli). Kullanıcıya gösterilecek Türkçe ad, `mac.extendInfo.CFBundleDisplayName` üzerinden değiştirilmeli — dosya adı asla değil.

`.p8` API anahtarı şu an `~/Downloads/` klasöründe duruyor; daha kalıcı bir yere (örn. `~/.appstoreconnect/private_keys/`) taşınması önerilir.
