# Xeena Games — Koleksi 8 Game Browser

Web app kumpulan game gratis, tanpa iklan, login email tanpa password. Dirancang untuk hosting **100% gratis** di Cloudflare Pages + Workers + domain kamu (`xeena.my.id`).

## Yang ada di paket ini

| File / Folder | Untuk apa |
|---|---|
| `index.html` | Homepage indeks 8 game (gaya zine "Paper Arcade") |
| `login.html` | Halaman login email+kode |
| `assets/styles.css` | Design system "Paper Arcade" (kertas + layar CRT) |
| `assets/app.js` | Sesi login, toast, helper API worker |
| `games/8ball.html` | 8-Ball Pool **v2.1** — fisika, spin, bot 3 level, P2P |
| `games/tictactoe.html` | Tic-Tac-Toe: 3×3 + 5×5 (Connect 4), AI |
| `games/memory.html` | Memory Match 4×4 & 6×6, tema emoji/huruf |
| `games/snake.html` | Snake klasik, dinding on/off, dpad untuk mobile |
| `games/2048.html` | 2048 + undo 3× |
| `games/mines.html` | Minesweeper 3 tingkat (pemula/menengah/ahli) |
| `games/flappy.html` | Flappy bird style |
| `games/tetris.html` | Tetris dengan hold + next + ghost + level |
| `worker/email-worker.js` | Cloudflare Worker: terima email verifikasi + API |
| `worker/wrangler.toml` | Konfigurasi deploy worker |
| `worker/package.json` | Script npm untuk deploy |

## Changelog — v2.2 "Bug Hunt"

Audit + playtest penuh di browser sungguhan (console bersih, 10/10 halaman).
Bug yang ditemukan dan diperbaiki:

**Bug fatal (game tidak jalan):**
- **8-Ball vs Bot deadlock** — `canPlay()` memblokir bot menembak; giliran bot tidak pernah selesai. Bot sekarang lolos guard via `shoot(true)`.
- **Tic-Tac-Toe vs AI deadlock** — guard `play()` memblokir AI menempatkan 'O'. Ditambah `parameter isAI`.
- **Tic-Tac-Toe 5×5 freeze** — minimax depth-4 (±255rb node × 28 garis) menggantung browser. Diganti AI heuristik (menang→blok→skor sel), respons < 50 ms.

**Bug gameplay:**
- Minesweeper: klik pertama bisa langsung kena ranjau → ranjau kini ditaruh SETELAH klik pertama, zona klik + 8 tetangga dijamin aman (tertest 90/90).
- Minesweeper mobile: long-press = pasang bendera TAPI juga membuka sel yang sama (bisa mati instan) → `preventDefault` di touchend setelah long-press.
- 2048: undo bisa dipakai 2× untuk snapshot yang sama (menghabiskan jatah) → snapshot dikosongkan setelah dipakai; label tombol undo kini update (×3→×0).
- 2048: mencapai tile 2048 memaksa mulai ulang → tombol "Lanjut Main" ditambahkan.
- Flappy: restart < 200 ms setelah mati memicu overlay "Game Over" di atas game baru (race condition) → guard run-id.
- Flappy: menyentuh plafon = mati → kini hanya mentok (sesuai Flappy Bird asli).
- Tetris: kontrol sentuh rusak (`moveLeft? ...` bukan kode valid — swipe 15px langsung geser) → ditulis ulang: tap = putar, geser per kolom, geser bawah = soft/hard drop.
- Tetris: hold saat spawn tertutup menumpuk piece di atas stack → cek validitas.
- Tetris: CSS mobile `height:90vw*2` (invalid) → skala papan via JS.
- Memory: emoji ganda di pool (bisa 4 kartu sama di papan) → pool unik; tema huruf pakai A–Z + 3 simbol Yunani.
- Snake: label speed yang disubmit tidak cocok dengan tombol → mode speed dilacak eksplisit.
- Tic-Tac-Toe: AI jalan duluan padahal pemain X → pemain selalu X dan jalan pertama; warna "seri" tidak di-reset.

## Cara login bekerja (yang kamu minta)

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. User buka login.html, masukin email                              │
│                                                                     │
│ 2. Frontend generate kode 6 digit, POST /api/request ke Worker      │
│    Worker simpan di KV: pending:<email> = {code, expires}           │
│                                                                     │
│ 3. Frontend TAMPILKAN kode + instruksi: "kirim email dari            │
│    alamatmu ke verify@xeena.my.id, isi body = kode"                 │
│    (tombol mailto: dibikin untuk buka aplikasi email otomatis)      │
│                                                                     │
│ 4. User kirim email manual dari Gmail/Outlook/dll                   │
│    To: verify@xeena.my.id                                           │
│    Body: 123456  (kode doang, tanpa kata lain)                       │
│                                                                     │
│ 5. Cloudflare Email Routing terima email → kirim ke Worker          │
│    Worker email handler:                                             │
│      - Cek from = email yang punya pending                          │
│      - Cek body = 6 digit pertama yang muncul                        │
│      - Bandingkan dengan kode di KV                                 │
│      - Kalau cocok & belum expired:                                 │
│          * Buat session token, simpan di KV                         │
│          * Tandai verified:<email> (TTL 5 menit untuk polling)       │
│          * Hapus pending                                             │
│      - Kalau gagal: message.setReject() — email gak diteruskan      │
│                                                                     │
│ 6. Frontend poll GET /api/status?email=X tiap 2.5 detik             │
│    Saat worker kembalikan {verified:true, token},                   │
│    frontend simpan token di localStorage → redirect ke homepage     │
│                                                                     │
│ 7. Setelah login, saat main game & game over, frontend POST        │
│    /api/score dengan Authorization: Bearer <token>                  │
│    Worker cek token valid di KV → simpan/update high-score          │
└─────────────────────────────────────────────────────────────────────┘
```

**Intinya**: kita **tidak pernah** kirim email keluar (tidak perlu Mailgun/SendGrid/MailChannels yang sekarang sudah berbayar). Yang kirim email hanya si user sendiri. Cloudflare Email Routing terima email masuk **gratis**.

---

## Deploy ke Cloudflare — Total $0

Ada 3 komponen yang perlu disiapkan:
1. **Cloudflare Pages** — untuk hosting file statis (HTML/CSS/JS game)
2. **Cloudflare Workers + KV** — untuk terima email & API login/skor
3. **Cloudflare Email Routing** — untuk route `verify@xeena.my.id` ke Worker

Plus **GitHub** sebagai tempat simpan source + auto-deploy ke Pages.

### STEP 1 — Push ke GitHub

```bash
cd xeena-games
git init
git add .
git commit -m "Xeena Games — initial release"
git branch -M main
# Buat repo kosong di GitHub dulu (https://github.com/new), lalu:
git remote add origin https://github.com/USERNAME/xeena-games.git
git push -u origin main
```

### STEP 2 — Deploy frontend ke Cloudflare Pages

1. Buka https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Pilih repo `xeena-games` yang barusan di-push
3. Build settings:
   - **Framework preset**: None
   - **Build command**: (kosong)
   - **Build output directory**: `/` (root — file statis langsung)
4. Klik **Save and Deploy**. Tunggu ±10 detik.
5. Akan dapat URL `xeena-games.pages.dev`. Test buka — homepage harus muncul.

### STEP 3 — Setup domain `xeena.my.id`

1. Di dashboard CF, add domain `xeena.my.id` (kalau belum). DNS pakai CF nameservers.
2. Pages → project kamu → **Custom domains** → **Setup a custom domain** → `xeena.my.id`
3. Tambahkan juga `www.xeena.my.id` kalau mau.
4. CF akan auto-buat CNAME record. Tunggu ±1 menit. Homepage akan live di `https://xeena.my.id`.

### STEP 4 — Deploy Cloudflare Worker (backend)

```bash
cd worker

# Install wrangler (CLI Cloudflare)
npm install

# Login ke akun CF kamu
npx wrangler login

# Buat KV namespace
npx wrangler kv:namespace create XEENA_KV
# Output akan kasih "id": "abc123...". Copy id itu.

# Edit wrangler.toml, ganti "GANTI_DENGAN_KV_ID_KAMU" dengan id di atas.

# (Opsional) batasi domain email pengirim. Default "*".
# Kalau mau batasi ke Gmail/Outlook saja:
npx wrangler secret put ALLOWED_FROM
# Lalu ketik: @gmail.com,@outlook.com

# Deploy!
npx wrangler deploy
```

Worker akan live di `https://xeena-games-worker.<subdomain-kamu>.workers.dev`.

### STEP 5 — Setup Custom Domain untuk Worker (sangat disarankan)

Kalau frontend hosting di `xeena.my.id` dan worker di `*.workers.dev`, ada potensi masalah CORS / cookie / blocking di beberapa browser. Solusinya: pasang worker di subdomain `api.xeena.my.id`:

1. Dashboard CF → **Workers & Pages** → pilih `xeena-games-worker` → **Settings** → **Triggers** → **Custom Domain** → **Add Custom Domain**
2. Masukkan: `api.xeena.my.id`
3. CF auto-buat DNS record. Tunggu ±1 menit.

Sekarang worker API bisa diakses di `https://api.xeena.my.id`.

### STEP 6 — Aktifkan Email Routing

Ini bagian paling penting supaya email ke `verify@xeena.my.id` sampai ke Worker.

1. Dashboard CF → pilih domain `xeena.my.id` → **Email** → **Email Routing**
2. Klik **Get started** / **Enable Email Routing**
3. CF akan minta tambah MX & TXT records ke DNS — klik **Add records automatically**
4. Tunggu ±1-2 menit sampai status **Ready**
5. Tab **Routes** → **Catch-all address** → klik **Edit**
   - Pilih: **Send to a Worker**
   - Worker: `xeena-games-worker`
   - Save
6. (Alternatif) Buat route spesifik:
   - **Create route** → **Custom address**: `verify@xeena.my.id` → **Send to a Worker** → `xeena-games-worker`

Setelah ini, setiap email yang dikirim ke `verify@xeena.my.id` akan masuk ke worker untuk diproses.

### STEP 7 — Hubungkan Frontend ke Worker

Edit dua file di root project: `index.html` dan `login.html`. Di dalam tag `<head>`, ubah baris ini:

```html
<meta name="xeena-worker" content="">
```

Jadi:

```html
<meta name="xeena-worker" content="https://api.xeena.my.id">
```

Begitu juga di `games/8ball.html` dan setiap file game yang ada baris itu — supaya saat game over, skor bisa ke worker. (Untuk 7 game lain, baris ini juga sudah ada di tiap file.)

Commit & push — Pages akan auto-deploy ulang.

### STEP 8 — Test Login End-to-End

1. Buka `https://xeena.my.id/login.html`
2. Masukkan email kamu (yang benar-benar bisa kamu akses)
3. Klik **Buat Kode Verifikasi** → muncul kode 6 digit
4. Klik tombol **"Buka aplikasi email (mail client)"** — akan buka aplikasi email default dengan To, Subject, Body terisi kode. Tinggal kirim.
   - Atau manual: dari aplikasi email kamu, kirim email To: `verify@xeena.my.id`, Body: kode 6 digit.
5. Tunggu ±5 detik. Halaman polling tiap 2.5s. Begitu email diproses worker, status berubah **verified**, langsung redirect ke homepage.
6. Selesai — kamu login.

---

## Verifikasi worker jalan

Cek dari terminal:

```bash
# Test ping
curl https://api.xeena.my.id/api/ping
# Expected: {"ok":true,"pong":true,"ts":1234567890}

# Test stats
curl https://api.xeena.my.id/api/stats
# Expected: {"users":0,"plays":0}

# Test request kode (simulasi)
curl -X POST https://api.xeena.my.id/api/request \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","code":"123456"}'
# Expected: {"ok":true,"expires_in":600}

# Test status
curl "https://api.xeena.my.id/api/status?email=test@example.com"
# Expected: {"verified":false}
```

## Roadmap / Yang bisa dikembangin

- [ ] PWA + offline support (manifest.json + service worker)
- [ ] Real-time multiplayer untuk 8ball pakai Worker Durable Objects (vs sekarang P2P PeerJS)
- [ ] Tournament mode
- [ ] Avatars / profile picture upload (pakai R2 storage)
- [ ] Achievement system
- [ ] Game lebih banyak (chess, checkers, solitaire, brick breaker, helicopter, dll — gampang ditambah ke folder `games/`)

## Troubleshooting

| Masalah | Solusi |
|---|---|
| Login stuck di "Menunggu email masuk" | Cek worker log: `npx wrangler tail`. Cek email benar-benar terkirim ke `verify@xeena.my.id`. Cek Email Routing aktif. Cek body email berisi kode 6 digit (bukan di subject). |
| Worker return 401 saat submit score | Token di localStorage expired (30 hari). Logout & login ulang. |
| Score tidak tersimpan walaupun login | Cek `wrangler tail`. Pastikan KV binding `XEENA_KV` benar. |
| Worker API `ECONNREFUSED` / not found | Cek custom domain sudah aktif. Cek `wrangler.toml` route. |
| Email ke `verify@` ditolak worker | Subject/body tidak mengandung 6 digit angka. Pastikan user kirim kode di body, bukan di subject. |

## Limit yang perlu diingat (semua CF free tier)

| Layanan | Limit free tier | Berapa user yang bisa ditampung |
|---|---|---|
| CF Workers | 100.000 request/hari | ±5.000 user aktif harian |
| KV reads | 100.000/hari | Aman |
| KV writes | 1.000/hari | Cukup untuk ±200 login & 800 game over per hari |
| Email Routing | Unlimited inbound | Aman |
| Pages | 500 build/bulan, unlimited request | Aman |

Kalau traffic tumbuh, upgrade ke Workers Paid ($5/bln) untuk 10M request/hari + KV writes 1M/hari. Tapi untuk pemula, free tier cukup untuk ratusan user harian.

---

Dibuat untuk `xeena.my.id` · Source: `/home/z/my-project/download/xeena-games/`
