/* v1.7.0 Google Drive auto-backup: transport only (sign-in + Drive REST calls).
   Nothing here runs until you connect Drive in Settings; the Google script is loaded only then.
   The backup file is encrypted by app.js before it gets here; Google only ever sees ciphertext. */
(function (root) {
  'use strict';
  // ← Paste your OAuth "Web application" client ID here (see DRIVE-SETUP.md).
  const CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file'; // only files this app created; it can't see the rest of your Drive
  const FILE_NAME = 'my-expenses-backup.json';
  const GSI_SRC = 'https://accounts.google.com/gsi/client';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

  let token = null, tokenExp = 0, client = null, gsiLoading = null, pending = null;
  const configured = () => !!CLIENT_ID && !/^YOUR_/.test(CLIENT_ID);
  const err = (code, msg) => Object.assign(new Error(msg), { code });

  function loadGsi() {
    if (root.google && root.google.accounts && root.google.accounts.oauth2) return Promise.resolve();
    if (gsiLoading) return gsiLoading;
    gsiLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script'); s.src = GSI_SRC; s.async = true;
      s.onload = () => (root.google && root.google.accounts && root.google.accounts.oauth2) ? resolve() : reject(err('OFFLINE', 'Google sign-in did not load.'));
      s.onerror = () => { gsiLoading = null; s.remove(); reject(err('OFFLINE', 'Can’t reach Google (offline?).')); };
      document.head.appendChild(s);
    });
    return gsiLoading;
  }
  function getClient() {
    if (client) return client;
    client = root.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE,
      callback: r => {
        const p = pending; pending = null; if (!p) return;
        if (r && r.access_token) { token = r.access_token; tokenExp = Date.now() + (Number(r.expires_in) || 3600) * 1000 - 120000; p.resolve(token); }
        else p.reject(err('AUTH', (r && (r.error_description || r.error)) || 'Google did not give access.'));
      },
      error_callback: e => { const p = pending; pending = null; if (p) p.reject(err('AUTH', (e && (e.message || e.type)) || 'Google sign-in was closed.')); }
    });
    return client;
  }
  // interactive=true: must run from a tap (it opens Google's window). false: silent refresh, fails if Google needs you.
  function signIn(interactive) { return signInAsync(interactive); }
  async function signInAsync(interactive) {
    if (!configured()) throw err('NOCLIENT', 'Google Drive isn’t set up in this copy of the app yet (no Client ID). See DRIVE-SETUP.md.');
    // when Google's script is already loaded this opens the window synchronously, inside the tap (Safari blocks it otherwise)
    if (!(root.google && root.google.accounts && root.google.accounts.oauth2)) await loadGsi();
    if (pending) pending.reject(err('AUTH', 'Superseded'));
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      try { getClient().requestAccessToken({ prompt: interactive ? '' : 'none' }); }
      catch (e) { pending = null; reject(err('AUTH', String(e && e.message || e))); }
      if (!interactive) setTimeout(() => { if (pending && pending.resolve === resolve) { pending = null; reject(err('AUTH', 'Silent sign-in timed out')); } }, 15000);
    });
  }
  const hasToken = () => !!token && Date.now() < tokenExp;
  async function ensureToken() {
    if (hasToken()) return token;
    try { return await signIn(false); } catch (e) { if (e.code === 'OFFLINE' || e.code === 'NOCLIENT') throw e; throw err('RECONNECT', 'Drive needs you to reconnect.'); }
  }
  async function call(url, opts, retried) {
    const t = await ensureToken();
    let res;
    try { res = await fetch(url, Object.assign({}, opts, { headers: Object.assign({ Authorization: 'Bearer ' + t }, (opts && opts.headers) || {}) })); }
    catch (e) { throw err('OFFLINE', 'Can’t reach Google Drive (offline?).'); }
    if (res.status === 401 && !retried) { token = null; return call(url, opts, true); }
    if (res.status === 401) throw err('RECONNECT', 'Drive needs you to reconnect.');
    return res;
  }
  async function failed(res, what) {
    let msg = ''; try { const j = await res.json(); msg = j && j.error && j.error.message || ''; } catch (_) {}
    return err(res.status === 404 ? 'NOTFOUND' : (res.status === 403 && /quota|storage/i.test(msg) ? 'FULL' : 'HTTP'), `${what} failed (${res.status}${msg ? ': ' + msg : ''})`);
  }
  async function findFile() {
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const res = await call(`${API}/files?q=${q}&spaces=drive&orderBy=modifiedTime%20desc&fields=files(id,modifiedTime,size)&pageSize=10`);
    if (!res.ok) throw await failed(res, 'Looking for the backup');
    const j = await res.json(); return (j.files && j.files[0]) || null;
  }
  // resumable upload: works for big files too (photos), one session per backup
  async function sendBody(initRes, body, what) {
    if (!initRes.ok) throw await failed(initRes, what);
    const loc = initRes.headers.get('Location'); if (!loc) throw err('HTTP', what + ' failed (no upload URL)');
    let res; try { res = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }); }
    catch (e) { throw err('OFFLINE', 'Upload interrupted (offline?).'); }
    if (!res.ok) throw await failed(res, what);
    return res.json();
  }
  const initHeaders = len => ({ 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json', 'X-Upload-Content-Length': String(len) });
  async function createFile(body) {
    const res = await call(`${UPLOAD}/files?uploadType=resumable&fields=id,modifiedTime`, { method: 'POST', headers: initHeaders(body.size), body: JSON.stringify({ name: FILE_NAME, mimeType: 'application/json', description: 'My Expenses encrypted backup (AES-256-GCM). Restore it in the app.' }) });
    return sendBody(res, body, 'Creating the backup file');
  }
  async function updateFile(id, body) {
    const res = await call(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=resumable&fields=id,modifiedTime`, { method: 'PATCH', headers: initHeaders(body.size), body: '{}' });
    if (res.status === 404) throw err('NOTFOUND', 'Backup file is gone from Drive');
    return sendBody(res, body, 'Updating the backup');
  }
  // overwrite by id; recreate when the file was deleted
  async function save(fileId, text) {
    const body = new Blob([text], { type: 'application/json' });
    if (fileId) {
      try { const r = await updateFile(fileId, body); return { id: r.id || fileId, modifiedTime: r.modifiedTime, created: false }; }
      catch (e) { if (e.code !== 'NOTFOUND') throw e; }
    }
    const r = await createFile(body); return { id: r.id, modifiedTime: r.modifiedTime, created: true };
  }
  async function download(fileId) {
    const res = await call(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
    if (!res.ok) throw await failed(res, 'Downloading the backup');
    return res.text();
  }
  function disconnect() {
    try { if (token && root.google && root.google.accounts) root.google.accounts.oauth2.revoke(token, () => {}); } catch (_) {}
    token = null; tokenExp = 0;
  }
  root.Drive = { CLIENT_ID, SCOPE, FILE_NAME, configured, signIn, hasToken, findFile, save, download, disconnect, preload: () => (configured() ? loadGsi().catch(() => {}) : Promise.resolve()) };
})(self);
