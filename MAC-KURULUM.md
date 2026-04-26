# 🍎 Engelsiz Video Düzenleyicisi - Mac Kurulum Rehberi

Merhaba! Bu uygulama, görme engelliler için erişilebilir video düzenleme deneyimi sunmak üzere tasarlanmıştır.

Aşağıda **DMG paketi ile kurulum** adımları yer almaktadır.

---

## 🚀 1. Kurulum Adımları

1. Size gönderilen **Engelsiz Video Düzenleyicisi.dmg** dosyasını indirin.
2. DMG dosyasına çift tıklayarak açın.
3. Açılan pencerede uygulamanın simgesini göreceksiniz. Uygulamayı sürükleyip **"Applications" (Uygulamalar)** klasörünün üzerine bırakın.
4. Kopyalama işlemi tamamlandığında DMG penceresini kapatın.

---

## 🛡️ 2. İlk Çalıştırma ve Güvenlik İzni

Apple, App Store dışındaki uygulamaları ilk açılışta engelleyebilir. Bunu aşmak için:

1. **Uygulamalar** klasörüne gidin.
2. **"Engelsiz Video Düzenleyicisi"** uygulamasını bulun.
3. Uygulamaya **Sağ Tıklayın** (veya Control tuşuna basılı tutarak tıklayın) ve menüden **"Aç"**ı seçin.
4. Ekrana "Geliştiricisi doğrulanamadı... yine de açmak istiyor musunuz?" gibi bir uyarı gelecektir.
5. **"Aç"** düğmesine basın.

**NOT:** Bu işlemi sadece bir kez yapmanız yeterlidir. Daha sonra uygulamayı normal şekilde açabilirsiniz.

---

## ⚠️ 3. "Hasarlı" veya "Açılamıyor" Hatası Alırsanız

Eğer uygulama açılırken hemen kapanıyor veya "Dosya hasarlı" uyarısı veriyorsa, Terminal'den küçük bir izin komutu girmemiz gerekir.

1. **Terminal** uygulamasını açın (Command + Boşluk tuşuna basıp "Terminal" yazın).
2. Aşağıdaki komutu kopyalayıp yapıştırın ve Enter'a basın:
   ```bash
   xattr -cr /Applications/"Engelsiz Video Düzenleyicisi.app"
   ```
   *(Eğer şifre sorarsa Mac oturum açma şifrenizi girin. Yazarken şifre ekranda görünmez, bu normaldir.)*

3. Şimdi uygulamayı tekrar açmayı deneyin.

---

## ♿ 4. VoiceOver Kullanımı

Uygulama VoiceOver ile tam uyumludur.

*   **Sekmeler Arası Gezinti:** Tab tuşu
*   **Oynat/Duraklat:** Boşluk (Space) tuşu
*   **Geri/İleri Sarma:** Sol ve Sağ Yön tuşları
*   **Menü:** Uygulamanın üst menüsüne (File, Edit vb.) standart macOS kısayolları ile erişilebilir.

İyi kullanımlar dileriz!
