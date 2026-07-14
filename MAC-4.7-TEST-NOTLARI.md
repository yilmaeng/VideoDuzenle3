# EVD 4.7 macOS Test Notları

Bu paket, EVD 4.7 kaynak kodunu macOS üzerinde denemek isteyen geliştiriciler ve beta test kullanıcıları için hazırlanmıştır.

## Önerilen Yol

İlk hedef DMG üretmek değil, uygulamayı kaynak koddan çalıştırıp hangi bölümlerin macOS üzerinde sorunsuz açıldığını görmektir.

```bash
chmod +x setup-mac.sh start.sh start-debug.sh
./setup-mac.sh
./start.sh
```

Hata alırsanız debug modunda çalıştırın:

```bash
./start-debug.sh
```

## Build Denemesi

Bu pakette `build:mac` komutu özellikle `dir` hedefiyle ayarlanmıştır. Böylece önce `dist/mac` veya `dist/mac-arm64` içindeki `.app` klasörü test edilir.

```bash
npm run build:mac
```

Apple Silicon için ayrı deneme:

```bash
npm run build:mac:arm64
```

Intel Mac için ayrı deneme:

```bash
npm run build:mac:x64
```

DMG denemesi ikinci aşamadır:

```bash
npm run build:mac:dmg
```

## Önemli Sınırlamalar

- Windows'a özel OBS paketi bu kaynak paketine taşınmadı.
- Windows yerel ses yakalama yardımcısı (`EvdProcessLoopbackCapture.exe`) bu pakette yoktur.
- Yayın odasının OBS, kayıt köprüsü ve sistem sesi yakalama gibi bölümleri macOS için ayrıca uyarlanmalıdır.
- Öncelikli test alanları: temel dosya açma, video oynatma, kesme/işaretleme, slideshow, altyazı/overlay/geçiş dışa aktarımı, Gemini/OpenAI/ElevenLabs API ile çalışan platform bağımsız bölümler.

## macOS İmza Notu

Apple Silicon ve güncel macOS sürümlerinde DMG olarak dağıtılan Electron uygulamaları çoğu zaman Developer ID sertifikası, doğru entitlements ve notarization ister. Bu nedenle `npm start` çalışsa bile imzasız DMG açılışta kapanabilir.

Profesyonel dağıtım için uzun vadeli hedef:

1. Developer ID Application sertifikası
2. Hardened runtime ve entitlements
3. Notarization
4. Apple Silicon ve Intel için ayrı veya universal test

## Swift Yeniden Yazım Hakkında

Swift ile yeniden yazım mümkün, fakat bu ayrı ve uzun vadeli bir ürün çalışmasıdır. EVD'nin video işleme, erişilebilirlik, AI servisleri, slideshow ve yayın odası mantığını sıfırdan taşımak gerekir. Kısa vadede en verimli yol, mevcut Electron 4.7 kaynaklarını macOS üzerinde çalıştırıp hangi modüllerin doğrudan taşınabildiğini görmektir.

