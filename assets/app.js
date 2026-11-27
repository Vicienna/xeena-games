/* ===== XEENA GAMES — Shared app logic =====
   - Sesi login (localStorage)
   - Toast helper
   - Konfigurasi worker endpoint
   */
window.XEENA = (function(){
  // === GANTI INI setelah deploy worker ke Cloudflare ===
  // Untuk dev lokal bisa pakai URL worker dev, untuk produksi pakai
  // https://<worker-name>.<subdomain>.workers.dev atau domain custom.
  // Default: subdomain workers yang umum dipakai. Ubah sesuai hasil deploy.
  const WORKER_URL = (() => {
    // Cek meta tag <meta name="xeena-worker" content="https://...">
    const m = document.querySelector('meta[name="xeena-worker"]');
    if (m && m.content) return m.content.replace(/\/$/,'');
    // Fallback: relative (kalau worker dipasang di route yang sama, mis.
    // pages.dev dengan function /api/* atau custom domain)
    return '';
  })();

  const KEY_TOKEN = 'xeena.token';
  const KEY_EMAIL = 'xeena.email';
  const KEY_USER  = 'xeena.user';

  function getToken(){ return localStorage.getItem(KEY_TOKEN); }
  function getEmail(){ return localStorage.getItem(KEY_EMAIL); }
  function getUser(){ try{return JSON.parse(localStorage.getItem(KEY_USER)||'null')}catch(e){return null} }

  function isLoggedIn(){ return !!getToken(); }

  function saveSession(tok, email){
    localStorage.setItem(KEY_TOKEN, tok);
    localStorage.setItem(KEY_EMAIL, email);
    const u = emailToUser(email);
    localStorage.setItem(KEY_USER, JSON.stringify(u));
  }

  function clearSession(){
    localStorage.removeItem(KEY_TOKEN);
    localStorage.removeItem(KEY_EMAIL);
    localStorage.removeItem(KEY_USER);
  }

  function emailToUser(email){
    if(!email) return null;
    const name = email.split('@')[0];
    const inits = (name.match(/[a-z0-9]/gi)||['?']).slice(0,2).join('').toUpperCase();
    return { email, name, initials: inits };
  }

  async function api(path, opts){
    opts = opts || {};
    const url = (WORKER_URL||'') + path;
    const headers = Object.assign({}, opts.headers||{});
    const tok = getToken();
    if(tok) headers['Authorization'] = 'Bearer '+tok;
    if(opts.body && typeof opts.body !== 'string'){
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const r = await fetch(url, {method:opts.method||'GET', headers, body:opts.body});
    let data = null;
    try{ data = await r.json(); }catch(e){ data = null; }
    return { ok:r.ok, status:r.status, data };
  }

  // path ke halaman login, disesuaikan kedalaman halaman
  function loginPath(){
    return /\/games\//.test(location.pathname) ? '../login.html' : 'login.html';
  }

  // ===== Render user chip di topbar (kalau ada element .userchip) =====
  function renderUserChip(){
    const chip = document.querySelector('.userchip');
    if(!chip) return;
    if(isLoggedIn()){
      const u = getUser();
      chip.classList.remove('out');
      chip.innerHTML = `<span class="av">${u?u.initials:'?'}</span><span class="em">${u?u.email:''}</span>`;
      chip.title = 'Klik untuk logout';
      chip.onclick = async ()=>{
        if(!confirm('Logout sekarang?')) return;
        // beritahu worker (opsional)
        try{ await api('/api/logout',{method:'POST'}); }catch(e){}
        clearSession();
        location.reload();
      };
    }else{
      chip.classList.add('out');
      chip.innerHTML = `<span class="av">?</span><span class="em">MASUK</span>`;
      chip.title = 'Klik untuk login';
      chip.onclick = ()=>{ location.href = loginPath(); };
    }
    chip.style.cursor = 'pointer';
  }

  // ===== Toast helper =====
  function ensureToast(){
    let t = document.getElementById('toast');
    if(!t){
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    return t;
  }
  function toast(msg, type, dur){
    const t = ensureToast();
    t.textContent = msg;
    t.className = 'show' + (type? ' '+type : '');
    clearTimeout(t._t);
    t._t = setTimeout(()=>{ t.className=''; }, dur||2200);
  }

  // ===== Guard: redirect ke login kalau butuh auth =====
  function requireLogin(){
    if(!isLoggedIn()){
      const here = encodeURIComponent(location.pathname.split('/').pop()||'');
      location.href = '../login.html?next='+here;
      return false;
    }
    return true;
  }

  // ===== Submit score ke worker =====
  async function submitScore(game, score, extra){
    if(!isLoggedIn()) return {ok:false};
    try{
      return await api('/api/score',{method:'POST',body:{game, score, extra:extra||{}}});
    }catch(e){ return {ok:false, err:e.message}; }
  }

  // ===== Get leaderboard =====
  async function leaderboard(game, limit){
    limit = limit||10;
    try{
      const r = await api('/api/leaderboard/'+encodeURIComponent(game)+'?limit='+limit);
      return r.data || { entries: [] };
    }catch(e){ return { entries: [] }; }
  }

  // Init: render chip sekali DOM siap
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', renderUserChip);
  }else{
    renderUserChip();
  }

  return {
    WORKER_URL,
    isLoggedIn, getToken, getEmail, getUser, saveSession, clearSession,
    emailToUser, api, renderUserChip, toast, requireLogin,
    submitScore, leaderboard
  };
})();
