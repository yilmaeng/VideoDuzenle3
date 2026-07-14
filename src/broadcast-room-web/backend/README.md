# EVD Yayın Odası Backend

Bu servis şunlardan sorumludur:

- oda oluşturma
- davet bağlantısı üretme
- host token üretme
- konuk token üretme
- temel oda durumu döndürme

## Ortam Değişkenleri

Gerekli değişkenler:

- `PORT`
- `APP_BASE_URL`
- `BROADCAST_ROOM_BASE_PATH`
- `BROADCAST_ROOM_API_BASE_PATH`
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `TOKEN_TTL_SECONDS`

## İlk Çalıştırma

1. `.env.example` dosyasını `.env` olarak kopyalayın.
2. LiveKit bilgilerini doldurun.
3. Bağımlılıkları kurun.
4. `npm start` ile servisi başlatın.

## İlk Endpointler

- `GET /api/health`
- `POST /api/broadcast-room/create`
- `POST /api/broadcast-room/host-token`
- `POST /api/broadcast-room/join-token`
- `GET /api/broadcast-room/:roomId`
- `POST /api/broadcast-room/:roomId/close`
