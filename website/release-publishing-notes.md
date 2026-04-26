# EVD Website Release Publishing Notes

Yeni bir Windows surumu yayinlarken asagidaki adimlari uygulayin:

1. Yeni kurulum ve portable dosyalarini `downloads/` klasorune yukleyin.
2. Kök dizindeki `update.json` dosyasini guncelleyin.
3. `website/releases.json` dosyasinda:
   - `latestVersion` alanini yeni surume cekin.
   - `releases` listesinin en ustune yeni surum blogunu ekleyin.

Ornek yeni surum blogu:

```json
{
  "version": "3.95.1",
  "channel": "Beta",
  "date": "2026-03-24",
  "title": "EVD 3.95.1 Beta",
  "notes": "Kucuk hata duzeltmeleri ve kurulum ile guncelleme akisinda iyilestirmeler.",
  "setupUrl": "downloads/EVD-Setup-v3.95.1.exe",
  "portableUrl": "downloads/EVD-Portable-v3.95.1.zip",
  "notesUrl": ""
}
```

Ornek `update.json`:

```json
{
  "version": "3.95.1",
  "setupUrl": "https://evd.drenginyilmaz.net/downloads/EVD-Setup-v3.95.1.exe",
  "portableUrl": "https://evd.drenginyilmaz.net/downloads/EVD-Portable-v3.95.1.zip",
  "notesUrl": "https://evd.drenginyilmaz.net/"
}
```

Not:
- `website/index.html` dosyasini yeni surum eklemek icin yeniden duzenlemeniz gerekmez.
- Ana sayfa, `website/releases.json` dosyasini okuyup indirilebilir surumleri otomatik listeler.
- Portable dagitim artik tek dosya `.exe` degil, icinde `EVD` klasoru bulunan bir `.zip` dosyasidir.
- Windows build almadan once uygulama ici `Hakkinda / About` metninde gorunen surum numarasinin da `src/locales/tr.json`, `en.json`, `de.json`, `es.json` ve `fr.json` dosyalarindaki `about_detail` alanlarinda guncellendigini kontrol edin. Aksi halde paket surumu yeni olsa bile Hakkinda penceresi eski surumu gosterebilir.
