# 🍏 Engelsiz Video Düzenleyicisi - Mac Derleme (Build) Rehberi


Bu rehber, uygulama geliştirme ortamını kurarak kendi bilgisayarınızda (özellikle Apple Silicon M1/M2/M3 işlemcili Mac'lerde) **yerel ve hatasız** bir sürüm üretmeniz için hazırlanmıştır.

## Kritik Not: Türkçe Karakter ve İmza Hatası

Mac paketlerinde imzalanan gerçek dosya ve bundle adları ASCII tutulmalıdır. Özellikle `ü` gibi karakterler macOS veya Electron paketleme sırasında farklı Unicode biçimlerine dönüşebilir; örneğin tek karakter `ü` yerine `u` + birleşen aksan işareti oluşabilir. Gözle aynı görünse bile kod imzası bu iki adı farklı kabul edebilir ve uygulama açılışta imza/geçersiz paket hatasıyla kapanabilir.

Bu nedenle Mac build sırasında imzalanan dosya adı `Engelsiz Video Duzenleyicisi` olarak ayarlanır. Kullanıcıya görünen uygulama adı ve arayüz metinleri Türkçe kalabilir: `Engelsiz Video Düzenleyicisi`.

Bu pakette bu ayar `package.json` içinde hazırdır. Ayrıca `build/prepare-mac-build-config.js` her Mac build öncesinde bu ayarı tekrar güvenceye alır.

## Kritik Not: app.asar Bütünlük Hash'i

Electron bazı paketlerde `Info.plist` içindeki `ElectronAsarIntegrity` alanıyla `Contents/Resources/app.asar` dosyasının SHA-256 hash'ini karşılaştırır. Bazı electron-builder akışlarında bu hash, `app.asar` son haline gelmeden önce yazılabildiği için uygulama açılışında güven doğrulaması sorunları yaşanabilir.

Bu pakette `build/afterPackFixes.js` bu değeri imzalama aşamasından hemen önce yeniden hesaplar ve `Info.plist` içine doğru hash'i yazar. Bu nedenle build alırken aşağıdaki `npm run build:mac:dmg` komutunu kullanın; doğrudan `npx electron-builder ...` çalıştırırsanız hazırlık adımlarını atlayabilirsiniz.

## Electron Sürümü Hakkında

Kurtarma raporunda Electron sürümünün güncellendiği yazıyor; ancak kök neden Electron sürümü değildi. Bu kaynak paketinde Electron 28.3.3 korunmuştur. Önce mevcut sürümle derleyip doğrulama yapmanız önerilir; Electron yükseltmesi ayrı bir test konusu olarak ele alınmalıdır.

## 4.7 Sonrası Görüntü/Renk Düzeltmeleri

Bu kaynak pakete 4.7 sonrasında eklenen HDR/renk koruma düzeltmeleri de dahil edilmiştir. HDR/HLG/BT.2020 kaynak videolar altyazı, overlay, geçiş veya slideshow işlemlerinden geçerken SDR/BT.709'a doğru ton eşleme ile dönüştürülür. Böylece iPhone HDR videolarda görülebilen soluk/gri çıktı sorunu azaltılır.

⚠️ **KRİTİK UYARI:** Paylaşılan son hata raporu (Crash Report), uygulamanın **Intel (x86_64)** mimarisinde çalıştığını kanıtlamaktadır (`Code Type: X86-64 (Translated)`). Bu, arkadaşınızın **arm64** sürümünü kurduğunu düşünse bile, sistemin arka planda Intel sürümünü (veya Intel için derlenmiş dosyaları) kullandığını gösterir.

Bunun en büyük sebebi **Terminal uygulamasının Rosetta (Intel) modunda çalışıyor olmasıdır.** Lütfen aşağıdaki adımları sırasıyla uygulayarak bu durumu düzelttiklerinden emin olun.

---

## 🛠️ 1. Gerekli Araçlar

Derleme işlemine başlamadan önce aşağıdaki araçların kurulu olduğundan emin olun:

1.  **Node.js**:
    *   Terminali açın ve `node -v` yazın. Version 18 veya 20 üzeri olmalıdır.
    *   Yoksa [nodejs.org](https://nodejs.org) adresinden indirip kurun.

2.  **Git** (Projeyi indirmek için gerekli, zaten indirdiyseniz atlayabilirsiniz).

---

## 📥 2. Hazırlık ve Kurulum

1.  Terminal uygulamasını açın.
2.  Şu komutu yazıp Enter'a basın: `arch`
    *   Eğer sonuç **`arm64`** çıkarsa: Harika! Doğru moddasınız.
    *   Eğer sonuç **`i386`** çıkarsa: **HATA!** Terminaliniz Intel modunda çalışıyor.
        *   *Çözüm:* Terminal uygulamasını kapatın. Uygulamalar > İzlenceler klasörüne gidin. Terminal ikonuna sağ tıklayıp "Bilgi Ver" (Get Info) deyin. **"Rosetta ile aç" (Open using Rosetta)** seçeneğindeki işareti **KALDIRIN**. Terminal'i yeniden açıp tekrar `arch` yazarak `arm64` olduğunu teyit edin.

3.  Proje klasörünün içine gidin. (Örneğin: `cd ~/Downloads/EngelsizVideoDuzenleyici`)
4.  Eski kurulum kalıntılarını temizlemek ve temiz bir başlangıç yapmak için şu komutları sırasıyla uygulayın:

```bash
# Varolan node_modules klasörünü siler (Hataları önlemek için)
rm -rf node_modules package-lock.json

# Bağımlılıkları sıfırdan yükler
npm install
```

*Not: `npm install` komutu, kullandığınız bilgisayarın işlemcisine (Apple Silicon veya Intel) uygun yerel kütüphaneleri (sharp vb.) otomatik olarak indirecektir.*

---

## 🏗️ 3. Uygulamayı Derleme (Build Alma)

En güvenli ve sorunsuz yöntem, uygulamanın kendi bilgisayarınızın mimarisine uygun sürümünü üretmesidir.

Terminalde şu komutu çalıştırın:

```bash
# Hazırlık adımı + arm64 DMG build
npm run build:mac:dmg
```

Sadece `.app` klasörü üretmek ve DMG oluşturmamak isterseniz:
```bash
npm run build:mac
```

Intel işlemcili bir Mac için ayrı test gerekiyorsa, hazırlık adımını çalıştırıp sonra x64 build alabilirsiniz:
```bash
npm run prepare:mac
npx electron-builder --mac dir --x64
```

---

## 📦 4. Kurulum ve Test

Derleme işlemi bittikten sonra:

1.  Proje klasöründe `dist` adlı bir klasör oluşacaktır.
2.  Bu klasörü açın (`open dist`).
3.  İçerisinde **`Engelsiz Video Duzenleyicisi-4.7.0-arm64.dmg`** (veya benzeri) isimli dosyayı bulun.
    *   **DİKKAT:** Dosya isminde **arm64** yazdığından emin olun (Apple Silicon işlemciler için).
    *   Eğer **x64** yazan dosyayı kurarsanız uygulama yine çökecektir.
4.  DMG dosyasını açıp uygulamayı kurun.

### 🛡️ "Geliştirici Doğrulanamadı" Hatası
Kendi derlediğiniz uygulama imzalı olmadığı için açılırken hata verebilir. Çözümü:
1.  Uygulamalar klasörüne gidin.
2.  Uygulamaya **Sağ Tıklayın** -> **Aç** deyin.
3.  Çıkan uyarıda tekrar **Aç** butonuna basın.

Eğer hala açılmıyorsa Terminal'de şu komutu uygulayın:
```bash
xattr -cr /Applications/"Engelsiz Video Duzenleyicisi.app"
```

Bu adımlarla çökme sorunu yaşamadan uygulamayı kullanabilirsiniz.
