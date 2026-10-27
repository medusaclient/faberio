# Faber.io — Online Medieval Multiplayer

Tarayıcıda oynanan, sunucu yetkili (server-authoritative) çok oyunculu orta çağ oyunu.
Node.js sunucusu hem statik dosyaları hem de WebSocket oyun sunucusunu birlikte çalıştırır.

## Gereksinimler

- **Node.js 20 veya üzeri**
- WebSocket destekleyen bir barındırma (VPS, Render, Railway, Fly.io vb.)
- Sadece statik hosting (GitHub Pages, Netlify statik vb.) **yetmez**; oyun sunucusu Node.js ile çalışmalıdır.

## Kurulum ve çalıştırma

```bash
cd faber
npm install
npm start
```

Varsayılan adres: `http://localhost:3000`

Farklı port:

```bash
# Windows (cmd)
set PORT=8080 && npm start

# Windows (PowerShell)
$env:PORT=8080; npm start

# Linux / macOS
PORT=8080 npm start
```

## Google ile giriş (opsiyonel)

Google girişi olmadan da **Misafir** olarak oynanabilir; hesaplar ve altın yine kalıcıdır.

Google girişini açmak için:

1. [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) üzerinden **OAuth 2.0 Client ID (Web application)** oluştur.
2. **Authorized JavaScript origins** kısmına sitenin adresini ekle (ör. `https://faber.example.com`, yerelde `http://localhost:3000`).
3. Sunucuyu ortam değişkeniyle başlat:

```bash
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com npm start
```

Windows PowerShell:

```powershell
$env:GOOGLE_CLIENT_ID="xxxxx.apps.googleusercontent.com"; npm start
```

## Dünyalar

- **Dünya 1 / Dünya 2 / Dünya 3** — her biri en fazla **50 oyuncu**.
- Aynı dünyaya giren oyuncular birbirini görür, savaşır, üs kurar ve klan kurabilir.

## Kalıcı veriler

Sunucu ilk çalıştığında `data/` klasörünü otomatik oluşturur:

| Dosya | İçerik |
|---|---|
| `data/accounts.json` | Hesaplar, kalıcı altın, envanterdeki altın sandığı |
| `data/clans.json` | Klanlar ve üyelikler |
| `data/worlds.json` | Dünya durumu (yapılar, sandıklar) |

- Veriler 3 saniyede bir diske yazılır.
- Yedek almak için `data/` klasörünü kopyalaman yeterli.
- Altın ölümde kaybolmaz; envanterdeki eşyalar ve kaynaklar ölünce yere düşer.

## Kontroller

| Tuş | İşlev |
|---|---|
| `WASD` | Hareket |
| `Sol tık` | Saldırı / yapı yerleştir |
| `B` | Yapı menüsü (duvar, kapı, kule, tuzak, çiftlik, sandık) |
| `C` | Üretim menüsü (silah/zırh) |
| `M` | Klan menüsü |
| `E` | Envanter (20 slot) |
| `P` | Büyük harita |
| `F` | Topla / sandık aç / eşya al |
| `Q` | Yapıyı altınla yükselt |
| `T` | Eşya bırak |
| `1-0` | Alt sıradaki 10 slotu seç |
| `Enter` | Sohbet (yakındaki oyuncular görür) |
| `/team mesaj` | Klan sohbeti |
| `Esc` | Menü / duraklat |

## Özellikler

- 3 dünya, 50 oyuncu/dünya, sunucu yetkili hareket ve savaş
- Klan kurma, katılma isteği, lider onayı, atma, klan sohbeti
- Kademeli silah ve zırh üretimi (ahşap → taş → demir → çelik → altın → efsanevi)
- 10 yapı tipi, altınla seviye yükseltme, çiftliklerde biriken kaynak
- 20 slot envanter + 10 slot kısayol çubuğu
- Sandıklar, 5 dakikada kaybolan yere düşen eşyalar
- Her 10 dakikada bir sandık etkinliği (%25 efsanevi kılıç)
- Kalıcı altın ve ana menü altın sıralaması
- Cinsiyet seçimi: kadın isimleri pembe, erkek isimleri mavi
- Türkçe, İngilizce, Rusça, Azerbaycanca arayüz

## Yayına alma notları

- Sunucu **tek örnek (single instance)** olacak şekilde tasarlandı; dünya durumu bellekte tutulur.
  Yatay ölçekleme (birden fazla instance) için Redis/veritabanı tabanlı oturum paylaşımı gerekir.
- Reverse proxy kullanıyorsan WebSocket yükseltmesine izin ver:
  - Nginx: `proxy_set_header Upgrade $http_upgrade;` ve `proxy_set_header Connection "upgrade";`
- HTTPS kullanıyorsan Google girişi için **Authorized JavaScript origins** adresini `https://` ile ekle.
- `PORT` değişkeni birçok platformda otomatik verilir; `npm start` yeterlidir.
- `node_modules/` ve `data/` sürüm kontrolüne eklenmemeli (`.gitignore` hazır).

## Dosya yapısı

```
faber/
├── server.js            # HTTP + WebSocket sunucusu, oyun mantığı
├── shared/defs.js       # Sunucu ve istemcinin ortak kullandığı tanımlar
├── public/
│   ├── index.html
│   ├── css/style.css
│   ├── js/game.js       # İstemci oyun döngüsü, arayüz, giriş
│   ├── js/sprites.js    # Canvas çizimleri
│   ├── js/i18n.js       # TR / EN / RU / AZ
│   └── assets/          # Arka plan ve fontlar
├── package.json
└── README.md
```
