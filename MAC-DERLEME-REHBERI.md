# 🍏 Engelsiz Video Düzenleyicisi - Mac Derleme (Build) Rehberi


Bu rehber, uygulama geliştirme ortamını kurarak kendi bilgisayarınızda (özellikle Apple Silicon M1/M2/M3 işlemcili Mac'lerde) **yerel ve hatasız** bir sürüm üretmeniz için hazırlanmıştır.

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
# Sadece mevcut sistem mimarisi için (Örn: M1/M2 Mac için arm64) derleme yapar
npx electron-builder --mac --arm64
```

Eğer Intel işlemcili bir Mac kullanıyorsanız:
```bash
npx electron-builder --mac --x64
```

Veya her iki sürümü de üretmek isterseniz (uzun sürebilir):
```bash
npm run build:mac
```

---

## 📦 4. Kurulum ve Test

Derleme işlemi bittikten sonra:

1.  Proje klasöründe `dist` adlı bir klasör oluşacaktır.
2.  Bu klasörü açın (`open dist`).
3.  İçerisinde **`Engelsiz Video Düzenleyicisi...arm64.dmg`** (veya benzeri) isimli dosyayı bulun.
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
xattr -cr /Applications/"Engelsiz Video Düzenleyicisi.app"
```

Bu adımlarla çökme sorunu yaşamadan uygulamayı kullanabilirsiniz.
