// Supabase sync layer — runs before Babel processes the JSX scripts.
// Gates the app behind login; pulls remote state on sign-in; pushes on every local change.
(function(){
  const SUPABASE_URL = 'https://qpxldkddhactqajlsyuk.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_6U_TclSOL-NkAKdUQLKmhQ_kgGvWK6k';
  const LS_PREFIX = 'taskslayer/';
  // Keys under the prefix that we deliberately do NOT sync:
  //   - cyberdog ticks constantly (per-device pet); syncing it creates echo loops
  //     that overwrite real task edits with stale data from other devices
  //   - first-run flags are one-shot and per-device
  const SYNC_EXCLUDE = new Set([
    'taskslayer/cyberdog/v2',
    'taskslayer/earned-seeded/v1',
    'taskslayer/ammo/starter-granted',
  ]);
  function shouldSync(key){
    return typeof key === 'string' && key.startsWith(LS_PREFIX) && !SYNC_EXCLUDE.has(key);
  }
  const BABEL_SCRIPTS = [
    { src: 'faces.jsx?v=5' },
    { src: 'cyberdog.jsx?v=5' },
    { src: 'app.jsx?v=8' },
  ];

  const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  window.__tsClient = client;

  // Collect all app state keys from localStorage (excluding per-device keys)
  function collectState(){
    const out = {};
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if (shouldSync(k)) out[k] = localStorage.getItem(k);
    }
    return out;
  }

  function applyRemote(state){
    // Only clear/replace sync'd keys — leave cyberdog & other per-device keys alone
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if (shouldSync(k)) toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
    for (const [k, v] of Object.entries(state || {})){
      if (shouldSync(k) && typeof v === 'string') localStorage.setItem(k, v);
    }
  }

  // Debounced push — runs 400ms after the last change (short so close-tab races are rare)
  let pushTimer = null;
  let pushing = false;
  let pendingDirty = false; // set on every local change, cleared after successful push
  async function pushNow(){
    if (pushing) return;
    const user = window.__tsUser;
    if (!user) return;
    pushing = true;
    pendingDirty = false; // snapshot: anything written during the upsert re-sets this
    try {
      const state = collectState();
      lastPushedJson = canonical(state);
      await client.from('user_state').upsert({
        user_id: user.id,
        state,
      });
      setBadge('synced');
    } catch (e){
      console.error('sync push failed', e);
      pendingDirty = true; // keep dirty so we retry
      setBadge('offline');
    } finally { pushing = false; }
  }
  function schedulePush(){
    if (!window.__tsUser) return;
    pendingDirty = true;
    setBadge('saving');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 400);
  }

  // Synchronous flush on page hide (close tab, switch app, etc.) via fetch keepalive.
  // fetch() with keepalive:true keeps the request alive after the page unloads,
  // unlike a normal fetch which gets killed.
  function flushOnHide(){
    if (!pendingDirty || !window.__tsUser) return;
    const user = window.__tsUser;
    const session = window.__tsClient?.auth?.session?.() || null;
    const state = collectState();
    const body = JSON.stringify({ user_id: user.id, state });
    // Pull the current access token from the session store Supabase keeps in localStorage
    let accessToken = null;
    try {
      for (let i = 0; i < localStorage.length; i++){
        const k = localStorage.key(i);
        if (k && k.startsWith('sb-') && k.endsWith('-auth-token')){
          const parsed = JSON.parse(localStorage.getItem(k));
          accessToken = parsed && parsed.access_token;
          break;
        }
      }
    } catch {}
    if (!accessToken) return;
    try {
      fetch(SUPABASE_URL + '/rest/v1/user_state?on_conflict=user_id', {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + accessToken,
          'Prefer': 'resolution=merge-duplicates',
        },
        body,
      });
    } catch(e){ /* page is unloading — nothing we can do */ }
  }
  window.addEventListener('pagehide', flushOnHide);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnHide();
  });

  // Monkey-patch localStorage writes so any app change triggers a push
  const _set = localStorage.setItem.bind(localStorage);
  const _rem = localStorage.removeItem.bind(localStorage);
  localStorage.setItem = function(k, v){
    _set(k, v);
    if (shouldSync(k)) schedulePush();
  };
  localStorage.removeItem = function(k){
    _rem(k);
    if (shouldSync(k)) schedulePush();
  };

  // Status badge (tiny, bottom-right)
  let badgeEl = null;
  function setBadge(state){
    if (!badgeEl) return;
    const map = {
      synced:  { text: '● SYNCED',  color: '#39ff14' },
      saving:  { text: '◐ SAVING',  color: '#ffb347' },
      offline: { text: '○ OFFLINE', color: '#ff3b2f' },
    };
    const cfg = map[state] || map.synced;
    badgeEl.textContent = cfg.text;
    badgeEl.style.color = cfg.color;
    badgeEl.style.borderColor = cfg.color;
  }
  function mountBadge(email){
    badgeEl = document.createElement('div');
    badgeEl.style.cssText = `
      position:fixed;bottom:6px;right:8px;z-index:9999;
      font-family:'Press Start 2P',monospace;font-size:7px;letter-spacing:1.5px;
      padding:4px 6px;background:rgba(0,0,0,0.7);border:1px solid #39ff14;color:#39ff14;
      cursor:pointer;user-select:none;
    `;
    badgeEl.title = email + ' — click to sign out';
    badgeEl.textContent = '● SYNCED';
    badgeEl.addEventListener('click', async () => {
      if (confirm('Sign out of ' + email + '?')){
        await client.auth.signOut();
        location.reload();
      }
    });
    document.body.appendChild(badgeEl);
  }

  // Load the React/JSX scripts (triggers the app)
  function bootApp(){
    for (const s of BABEL_SCRIPTS){
      const el = document.createElement('script');
      el.type = 'text/babel';
      el.src = s.src;
      document.body.appendChild(el);
    }
    // Trigger Babel to compile any newly-added type="text/babel" scripts
    if (window.Babel && typeof window.Babel.transformScriptTags === 'function'){
      setTimeout(() => window.Babel.transformScriptTags(), 0);
    }
  }

  // Login UI — retro terminal styling to match app
  function showLogin(message){
    const overlay = document.createElement('div');
    overlay.id = 'ts-login-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;
      background:radial-gradient(ellipse at center,#041604 0%,#010401 70%,#000 100%);
      font-family:'Share Tech Mono',monospace;color:#39ff14;
    `;
    overlay.innerHTML = `
      <div style="
        width:min(420px,92vw);padding:28px;
        border:3px solid #1f8f10;outline:2px solid #000;
        background:linear-gradient(180deg,rgba(16,41,16,0.35),rgba(3,10,3,0.9)),#020602;
        box-shadow:inset 0 0 60px rgba(57,255,20,0.08),0 0 0 4px #000;
      ">
        <div style="font-family:'Press Start 2P',monospace;font-size:14px;letter-spacing:3px;color:#aaff6a;text-shadow:0 0 8px rgba(170,255,106,.65);margin-bottom:6px;">TASK SLAYER</div>
        <div style="font-family:'Press Start 2P',monospace;font-size:8px;letter-spacing:2px;color:#1f8f10;margin-bottom:20px;">// SECURE LINK REQUIRED //</div>
        <form id="ts-login-form">
          <label style="font-family:'Press Start 2P',monospace;font-size:8px;letter-spacing:1.2px;color:#1f8f10;display:block;margin-bottom:6px;">OPERATOR EMAIL</label>
          <input type="email" id="ts-email" required autocomplete="email" placeholder="you@example.com" style="
            width:100%;background:#000;color:#39ff14;border:2px solid #0c4a0a;
            font-family:'VT323',monospace;font-size:20px;padding:8px 10px;outline:none;caret-color:#aaff6a;
          "/>
          <button type="submit" id="ts-login-btn" style="
            margin-top:16px;width:100%;font-family:'Press Start 2P',monospace;font-size:10px;letter-spacing:2px;
            padding:12px;background:#072207;color:#aaff6a;border:2px solid #1f8f10;cursor:pointer;text-transform:uppercase;
          ">SEND MAGIC LINK</button>
        </form>
        <div id="ts-login-msg" style="margin-top:14px;font-family:'VT323',monospace;font-size:16px;color:#aaff6a;min-height:20px;">${message || ''}</div>
        <div style="margin-top:18px;padding-top:12px;border-top:1px dashed #0c4a0a;font-family:'VT323',monospace;font-size:13px;color:#1f8f10;line-height:1.4;">
          We'll email you a one-time sign-in link. No password.<br/>Your tasks sync across devices on this same email.
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('#ts-login-form');
    const emailEl = overlay.querySelector('#ts-email');
    const btn = overlay.querySelector('#ts-login-btn');
    const msg = overlay.querySelector('#ts-login-msg');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailEl.value.trim();
      if (!email) return;
      btn.disabled = true; btn.textContent = 'TRANSMITTING…';
      msg.textContent = '';
      try {
        const { error } = await client.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: location.origin + location.pathname },
        });
        if (error) throw error;
        msg.innerHTML = '<span style="color:#aaff6a;">Link sent. Check your inbox — it expires in 1 hour.</span>';
        btn.textContent = 'LINK SENT';
      } catch (err) {
        msg.innerHTML = '<span style="color:#ff3b2f;">ERROR: ' + (err.message || 'failed') + '</span>';
        btn.disabled = false; btn.textContent = 'SEND MAGIC LINK';
      }
    });
  }

  // Remember what we last pushed so realtime echoes of our own changes are ignored
  let lastPushedJson = '';

  // Deterministic stringify (sorted keys) so Postgres JSONB round-trips compare equal
  function canonical(obj){
    if (!obj || typeof obj !== 'object') return JSON.stringify(obj);
    return JSON.stringify(Object.keys(obj).sort().reduce((o,k)=>{ o[k]=obj[k]; return o; }, {}));
  }

  let reloadTimer = null;
  const REMOTE_RELOAD_DELAY_MS = 2000; // 2s throttle now that cyberdog echo loops are gone

  function subscribeRealtime(userId){
    const channel = client
      .channel('user_state:' + userId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_state',
        filter: 'user_id=eq.' + userId,
      }, (payload) => {
        const incoming = payload.new && payload.new.state;
        if (!incoming) return;
        const incomingJson = canonical(incoming);
        // Our own echo — skip
        if (incomingJson === lastPushedJson) return;
        // Already matches current local state — nothing to do
        if (incomingJson === canonical(collectState())) return;
        // Schedule a reload; bump the timer if more events arrive in the meantime
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          // Re-check at fire time — if nothing's actually diverged now, skip
          if (canonical(incoming) === canonical(collectState())) return;
          applyRemote(incoming);
          lastPushedJson = canonical(incoming);
          location.reload();
        }, REMOTE_RELOAD_DELAY_MS);
      })
      .subscribe();
    return channel;
  }

  async function onSignedIn(session){
    window.__tsUser = session.user;
    // Fetch remote state
    let remote = null;
    try {
      const { data, error } = await client
        .from('user_state')
        .select('state')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (!error && data) remote = data.state;
    } catch(e){ console.warn('fetch state failed', e); }

    const local = collectState();
    const hasRemote = remote && Object.keys(remote).length > 0;
    const hasLocal = Object.keys(local).length > 0;

    if (hasRemote){
      applyRemote(remote);
      lastPushedJson = canonical(remote);
    } else if (hasLocal){
      // First login — upload existing localStorage so it lives in the cloud
      try {
        lastPushedJson = canonical(local);
        await client.from('user_state').upsert({ user_id: session.user.id, state: local });
      } catch(e){ console.warn('initial upload failed', e); }
    }

    // Remove login overlay if present
    const ov = document.getElementById('ts-login-overlay');
    if (ov) ov.remove();

    mountBadge(session.user.email);
    subscribeRealtime(session.user.id);
    bootApp();
  }

  // Main entry
  (async () => {
    // supabase-js auto-detects the magic-link hash on load if detectSessionInUrl:true
    const { data: { session } } = await client.auth.getSession();
    if (session){
      await onSignedIn(session);
    } else {
      showLogin();
    }
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session && !window.__tsUser){
        onSignedIn(session);
      }
      if (event === 'SIGNED_OUT'){
        window.__tsUser = null;
      }
    });
  })();
})();
