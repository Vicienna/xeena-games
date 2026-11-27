/* ============================================================================
   XEENA GAMES — Cloudflare Worker
   ----------------------------------------------------------------------------
   Tugas:
   1. Terima email ke verify@xeena.my.id (Email Worker), parse pengirim + body
   2. Bandingkan dengan kode pending di KV → kalau cocok, mark verified + buat session
   3. Sajikan API:
        POST /api/request   { email, code }            → simpan pending
        GET  /api/status?email=X                          → cek apakah sudah verified
        POST /api/cancel   { email }                     → hapus pending
        POST /api/logout                                   → hapus session
        POST /api/score    { game, score, extra }         → submit skor (butuh token)
        GET  /api/leaderboard/:game?limit=N                → top scores
        GET  /api/stats                                      → { users, plays }
   ----------------------------------------------------------------------------
   Binding yang HARUS disiapkan di dashboard CF Workers:
   - KV namespace:   XEENA_KV     (KV namespace ID dari wrangler.toml)
   - Email Routing:  route semua email ke verify@xeena.my.id → Worker ini (Email Worker)
   - Secret:         ALLOWED_FROM = "*" (boleh dari siapa saja; atau daftar domain email
                     tertentu kalau mau batasi). Kalau mau batasi ke domain tertentu
                     misalnya "@gmail.com,@outlook.com" set secret tsb.
   ============================================================================ */

const TTL_PENDING = 10 * 60;          // 10 menit
const TTL_SESSION = 30 * 24 * 60 * 60; // 30 hari
const TTL_VERIFIED = 5 * 60;            // verified window: 5 menit untuk polling

// Kunci helper
const K = {
  pending:  e => `pending:${e}`,
  verified:e => `verified:${e}`,
  session: t => `session:${t}`,
  score:   (g,e) => `score:${g}:${e}`,
  user:    e => `user:${e}`,
  metaUsers: 'meta:users',
  metaPlays: 'meta:plays',
  gamePlays: g => `gameplays:${g}`,
  top:     g => `top:${g}`,
};

// ===== CORS / response helpers =====
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json'
};
function json(body, status=200, extra={}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, ...extra }
  });
}
function err(msg, status=400){ return json({error:msg}, status); }

// ===== Simple random token =====
function token(len=24){
  const a='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s='';const b=new Uint8Array(len);
  crypto.getRandomValues(b);
  for(let i=0;i<len;i++) s+=a[b[i]%a.length];
  return s;
}

// ===== Util: case-insensitive email, lowercase + trim =====
function normEmail(e){
  if(!e || typeof e!=='string') return '';
  return e.trim().toLowerCase();
}
function validEmail(e){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// Cek apakah sender allowed (kalau ALLOWED_FROM secret diset)
function isSenderAllowed(from, env){
  const allow = env.ALLOWED_FROM || '*';
  if(allow === '*') return true;
  return allow.split(',').map(s=>s.trim().toLowerCase()).some(p=>{
    if(!p) return false;
    if(p.startsWith('@')) return from.endsWith(p);   // domain match
    return from === p;                                  // exact match
  });
}

// ===== MIME parser sederhana: ambil text/plain body =====
async function extractTextBody(message){
  // Baca raw email sebagai string
  const raw = await new Response(message.raw).text();
  // Cari boundary multipart
  const bMatch = raw.match(/boundary\s*=\s*"?([^";\r\n]+)"?/i);
  let textPart = '';
  if(bMatch){
    const b = '--' + bMatch[1];
    const parts = raw.split(b);
    for(const p of parts){
      // ambil hanya part yang content-type text/plain dan bukan attachment
      if(/content-type:\s*text\/plain/i.test(p) && !/content-disposition:\s*attachment/i.test(p)){
        // cari double newline yang menandai akhir header
        const m = p.indexOf('\r\n\r\n')>=0 ? p.indexOf('\r\n\r\n') : p.indexOf('\n\n');
        if(m>=0){
          let body = p.slice(m).replace(/^[\r\n]+/,'');
          // decode quoted-printable / base64 sederhana
          if(/content-transfer-encoding:\s*quoted-printable/i.test(p)){
            body = body
              .replace(/=\r?\n/g,'')
              .replace(/=([0-9A-F]{2})/gi,(m,h)=>String.fromCharCode(parseInt(h,16)));
          }else if(/content-transfer-encoding:\s*base64/i.test(p)){
            try{ body = atob(body.replace(/\s+/g,'')); }catch(e){}
          }
          textPart = body;
          break;
        }
      }
    }
  }else{
    // non-multipart: ambil setelah header pertama
    const m = raw.indexOf('\r\n\r\n')>=0 ? raw.indexOf('\r\n\r\n') : raw.indexOf('\n\n');
    if(m>=0) textPart = raw.slice(m).replace(/^[\r\n]+/,'');
  }
  return textPart.trim();
}

// ===== Email handler (Email Worker) =====
export default {
  async email(message, env, ctx){
    const from = normEmail(message.from);
    const to   = normEmail(message.to);
    // hanya proses email ke alamat verify
    if(to !== 'verify@xeena.my.id'){
      // reject / forward kalau bukan. Untuk aman, drop.
      message.setReject('Address not handled');
      return;
    }
    if(!isSenderAllowed(from, env)){
      message.setReject('Sender not allowed');
      return;
    }
    // ambil body text
    let body = '';
    try{ body = await extractTextBody(message); }catch(e){
      message.setReject('Cannot parse body');
      return;
    }
    // ambil 6 digit pertama yang muncul
    const m = body.match(/\b(\d{6})\b/);
    if(!m){
      message.setReject('No 6-digit code found');
      return;
    }
    const code = m[1];
    // cek pending
    const pRaw = await env.XEENA_KV.get(K.pending(from));
    if(!pRaw){
      message.setReject('No pending verification for this address');
      return;
    }
    let pending;
    try{ pending = JSON.parse(pRaw); }catch(e){ pending = null; }
    if(!pending){
      message.setReject('Invalid pending record');
      return;
    }
    // cek expiry
    if(Date.now() > pending.expires){
      await env.XEENA_KV.delete(K.pending(from));
      message.setReject('Code expired');
      return;
    }
    // cek kode cocok (constant-time compare)
    if(code !== pending.code){
      // bisa juga bandingkan dengan timingSafeEqual tapi Worker punya crypto.subtle
      // untuk kesederhanaan pakai string compare
      message.setReject('Code mismatch');
      return;
    }
    // === SUCCESS: buat session, hapus pending ===
    const tok = token(32);
    const sessionRec = {
      email: from,
      token: tok,
      created: Date.now(),
      expires: Date.now() + TTL_SESSION*1000
    };
    await env.XEENA_KV.put(K.session(tok), JSON.stringify(sessionRec), { expirationTtl: TTL_SESSION });
    // tandai verified (window pendek untuk polling)
    await env.XEENA_KV.put(K.verified(from), JSON.stringify({ token: tok, at: Date.now() }), { expirationTtl: TTL_VERIFIED });
    // hapus pending
    await env.XEENA_KV.delete(K.pending(from));
    // catat user baru
    const uRaw = await env.XEENA_KV.get(K.user(from));
    if(!uRaw){
      await env.XEENA_KV.put(K.user(from), JSON.stringify({ email: from, joined: Date.now(), plays: 0 }));
      // increment user count
      let n = parseInt(await env.XEENA_KV.get(K.metaUsers) || '0', 10);
      await env.XEENA_KV.put(K.metaUsers, String(n+1));
    }
    // email tidak di-forward ke mana-mana — selesai diproses worker
  },

  async fetch(req, env, ctx){
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight
    if(req.method === 'OPTIONS'){
      return new Response(null, { status:204, headers: CORS });
    }

    // ===== Routes =====
    try{
      if(path === '/api/request' && req.method === 'POST')   return await apiRequest(req, env);
      if(path === '/api/status'  && req.method === 'GET')    return await apiStatus(req, env, url);
      if(path === '/api/cancel'  && req.method === 'POST')   return await apiCancel(req, env);
      if(path === '/api/logout'  && req.method === 'POST')   return await apiLogout(req, env);
      if(path === '/api/score'   && req.method === 'POST')   return await apiScore(req, env);
      if(path.startsWith('/api/leaderboard/') && req.method === 'GET') return await apiLeaderboard(req, env, url, path);
      if(path === '/api/stats'   && req.method === 'GET')    return await apiStats(req, env);
      if(path === '/' )           return json({ ok:true, service:'xeena-games-worker', version:'1.0' });
      if(path === '/api/ping' )   return json({ ok:true, pong:true, ts: Date.now() });
      return err('Not found', 404);
    }catch(e){
      return err('Server error: ' + (e && e.message || 'unknown'), 500);
    }
  }
};

// ===== POST /api/request =====
async function apiRequest(req, env){
  let body;
  try{ body = await req.json(); }catch(e){ return err('Invalid JSON'); }
  const email = normEmail(body.email);
  const code  = String(body.code || '').trim();
  if(!validEmail(email)) return err('Email tidak valid');
  if(!/^\d{6}$/.test(code)) return err('Kode harus 6 digit angka');

  // simpan pending
  await env.XEENA_KV.put(K.pending(email), JSON.stringify({
    code, expires: Date.now() + TTL_PENDING*1000, created: Date.now()
  }), { expirationTtl: TTL_PENDING });

  return json({ ok:true, expires_in: TTL_PENDING });
}

// ===== GET /api/status?email=X =====
async function apiStatus(req, env, url){
  const email = normEmail(url.searchParams.get('email'));
  if(!validEmail(email)) return err('Email tidak valid');
  const v = await env.XEENA_KV.get(K.verified(email));
  if(v){
    const data = JSON.parse(v);
    return json({ verified: true, token: data.token });
  }
  return json({ verified: false });
}

// ===== POST /api/cancel =====
async function apiCancel(req, env){
  let body;
  try{ body = await req.json(); }catch(e){ return err('Invalid JSON'); }
  const email = normEmail(body.email);
  if(email) await env.XEENA_KV.delete(K.pending(email));
  return json({ ok:true });
}

// ===== POST /api/logout =====
async function apiLogout(req, env){
  const tok = (req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  if(tok) await env.XEENA_KV.delete(K.session(tok));
  return json({ ok:true });
}

// ===== Auth middleware: ambil email dari token =====
async function getSessionEmail(req, env){
  const tok = (req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  if(!tok) return null;
  const s = await env.XEENA_KV.get(K.session(tok));
  if(!s) return null;
  try{
    const sess = JSON.parse(s);
    if(Date.now() > sess.expires) return null;
    return sess.email;
  }catch(e){ return null; }
}

// ===== POST /api/score { game, score, extra } =====
async function apiScore(req, env){
  const email = await getSessionEmail(req, env);
  if(!email) return err('Unauthorized', 401);
  let body;
  try{ body = await req.json(); }catch(e){ return err('Invalid JSON'); }
  const game  = String(body.game || '').replace(/[^a-z0-9_-]/gi,'');
  const score = Number(body.score);
  if(!game || !isFinite(score)) return err('game & score wajib');

  // simpan high-score per user per game
  const key = K.score(game, email);
  const prevRaw = await env.XEENA_KV.get(key);
  let prev = -Infinity;
  if(prevRaw) prev = Number(JSON.parse(prevRaw).score);
  let newHigh = false;
  if(score > prev){
    await env.XEENA_KV.put(key, JSON.stringify({ email, game, score, at: Date.now(), extra: body.extra||{} }));
    newHigh = true;
    // update top list (JSON array sederhana)
    const topRaw = await env.XEENA_KV.get(K.top(game));
    let top = [];
    try{ top = topRaw ? JSON.parse(topRaw) : []; }catch(e){ top = []; }
    // cari entry email ini
    const i = top.findIndex(x => x.email === email);
    if(i>=0){
      if(score > top[i].score){ top[i].score = score; top[i].at = Date.now(); }
    }else{
      top.push({ email, score, at: Date.now() });
    }
    top.sort((a,b)=>b.score - a.score);
    top = top.slice(0, 50);
    await env.XEENA_KV.put(K.top(game), JSON.stringify(top));
  }

  // increment plays (meta + per-game)
  let p = parseInt(await env.XEENA_KV.get(K.metaPlays) || '0', 10);
  await env.XEENA_KV.put(K.metaPlays, String(p+1));
  let gp = parseInt(await env.XEENA_KV.get(K.gamePlays(game)) || '0', 10);
  await env.XEENA_KV.put(K.gamePlays(game), String(gp+1));

  // update user.plays
  const uRaw = await env.XEENA_KV.get(K.user(email));
  if(uRaw){
    const u = JSON.parse(uRaw);
    u.plays = (u.plays||0)+1;
    await env.XEENA_KV.put(K.user(email), JSON.stringify(u));
  }

  return json({ ok:true, newHigh, score });
}

// ===== GET /api/leaderboard/:game?limit=N =====
async function apiLeaderboard(req, env, url, path){
  const game = decodeURIComponent(path.replace('/api/leaderboard/','')).replace(/[^a-z0-9_-]/gi,'');
  if(!game) return err('Game wajib');
  const limit = Math.min(Number(url.searchParams.get('limit'))||10, 50);
  const topRaw = await env.XEENA_KV.get(K.top(game));
  let top = [];
  try{ top = topRaw ? JSON.parse(topRaw) : []; }catch(e){}
  // mask email (privasi): tampilkan only awalan + domain
  const mask = em => {
    const [u,d] = em.split('@');
    if(!d) return em;
    const show = u.slice(0, Math.min(3, u.length));
    return show + '***@' + d;
  };
  return json({ entries: top.slice(0, limit).map(x=>({ email: mask(x.email), score: x.score, at: x.at })) });
}

// ===== GET /api/stats =====
async function apiStats(req, env){
  const users = parseInt(await env.XEENA_KV.get(K.metaUsers) || '0', 10);
  const plays = parseInt(await env.XEENA_KV.get(K.metaPlays) || '0', 10);
  return json({ users, plays });
}
