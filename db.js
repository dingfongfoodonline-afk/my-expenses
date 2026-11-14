/* Tiny IndexedDB wrapper. All data stays in this browser on this device.
   When encryption is on, every record (except a few non-secret meta keys) is stored AES-GCM encrypted via Vault. */
(function (root) {
  'use strict';
  const DB_NAME = 'my-expenses';
  const DB_VER = 3; // v3 (app 1.6.0): + mmitems (Money Mother)
  const STORES = { entries: 'id', kv: 'key', mlitems: 'id', mlsnaps: 'id', mmitems: 'id' };
  const PLAIN_KV = new Set(['crypto', 'hintDismissed', 'lastBackup']); // never secret, readable while locked
  let dbp = null;
  let dek = null;       // data key in memory only while unlocked
  let encOn = false;    // encryption enabled (meta present)
  // v1.6.2: every data write (put/delete/clear) goes through write(), which notifies listeners after commit.
  // The app then compares each tab's totals with the stored ones and bumps that tab's "last updated" time only
  // when a total changed. The stamps live in kv 'lastUpdated' (encrypted like other data, included in backups).
  const STAMP_KEY = 'lastUpdated';
  const listeners = new Set();

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('entries')) { const s = db.createObjectStore('entries', { keyPath: 'id' }); s.createIndex('ts', 'ts'); }
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('mlitems')) db.createObjectStore('mlitems', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('mlsnaps')) db.createObjectStore('mlsnaps', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('mmitems')) db.createObjectStore('mmitems', { keyPath: 'id' }); // additive: existing stores untouched
      };
      req.onsuccess = () => { const db = req.result; db.onversionchange = () => { db.close(); dbp = null; }; resolve(db); };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database blocked — close other tabs of this app.'));
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      let result;
      Promise.resolve(fn(Array.isArray(store) ? n => t.objectStore(n) : t.objectStore(store), t)).then(r => { result = r; }, reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    }));
  }
  function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  function canon(o) { const k = Object.keys(o).filter(x => x !== 'photo' && x !== 'thumb' && x !== 'morePhotos').sort(); return JSON.stringify(k.map(x => [x, o[x]])); }
  function sameMore(a, b) { const x = Array.isArray(a) ? a : [], y = Array.isArray(b) ? b : []; return x.length === y.length && x.every((v, i) => !(v instanceof Blob) || (y[i] instanceof Blob && y[i].size === v.size)); }
  function locked() { const e = new Error('Locked'); e.code = 'LOCKED'; return e; }

  // encrypt before the transaction (WebCrypto is async and would auto-commit an open transaction)
  async function seal(store, rec) {
    if (!encOn || (store === 'kv' && PLAIN_KV.has(rec.key))) return rec;
    if (!dek) throw locked();
    return Vault.encryptRecord(dek, rec, STORES[store]);
  }
  async function open_(store, rec) {
    if (!rec || !rec._enc) return rec;
    if (!dek) throw locked();
    return Vault.decryptRecord(dek, rec, STORES[store]);
  }
  async function write(stores, fn, keys) {
    const r = await tx(stores, 'readwrite', fn);
    const info = { stores: [].concat(stores), keys: keys || [] };
    for (const cb of listeners) { try { cb(info); } catch (_) {} }
    return r;
  }
  async function getAll(store) { const raw = await tx(store, 'readonly', s => reqP(s.getAll())); const out = []; for (const r of raw || []) out.push(await open_(store, r)); return out; }
  async function putMany(store, list) {
    const sealed = []; for (const r of list) sealed.push(await seal(store, r));
    if (!list.length) return;
    return write(store, s => { for (const r of sealed) s.put(r); }, store === 'kv' ? list.map(r => r.key) : null);
  }
  function del(store, id) { return write(store, s => { s.delete(id); }); }
  function clr(stores) { stores = [].concat(stores); return write(stores, get => { for (const st of stores) get(st).clear(); }); }

  const DB = {
    open,
    // ---- encryption state ----
    isEncrypted: () => encOn,
    isUnlocked: () => !encOn || !!dek,
    setKey(k) { dek = k || null; },
    // ---- last updated (v1.6.2) ----
    onWrite(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    getStamps() { return DB.getKV(STAMP_KEY, null); },
    async setStamps(v) { const rec = await seal('kv', { key: STAMP_KEY, value: v }); return tx('kv', 'readwrite', s => { s.put(rec); }); }, // no listener: not a data change
    async loadCryptoMeta() { const r = await tx('kv', 'readonly', s => reqP(s.get('crypto'))); encOn = !!(r && r.value); return r ? r.value : null; },
    async setCryptoMeta(meta) { await tx('kv', 'readwrite', s => { if (meta) s.put({ key: 'crypto', value: meta }); else s.delete('crypto'); }); encOn = !!meta; },
    // Re-write every record encrypted (newKey) or plaintext (null) in ONE transaction across all stores.
    async rewriteAll(newKey) {
      const plain = {};
      for (const st of Object.keys(STORES)) plain[st] = (await getAll(st)).filter(r => !(st === 'kv' && r.key === 'crypto'));
      const out = {};
      for (const st of Object.keys(STORES)) {
        out[st] = [];
        for (const r of plain[st]) {
          if (newKey && !(st === 'kv' && PLAIN_KV.has(r.key))) {
            const sealed = await Vault.encryptRecord(newKey, r, STORES[st]);
            const back = await Vault.decryptRecord(newKey, sealed, STORES[st]); // verify before committing
            if (canon(back) !== canon(r) || (r.photo instanceof Blob && (!back.photo || back.photo.size !== r.photo.size)) ||
                (r.thumb instanceof Blob && (!back.thumb || back.thumb.size !== r.thumb.size)) || !sameMore(r.morePhotos, back.morePhotos)) throw new Error('Verification failed for ' + st);
            out[st].push(sealed);
          } else out[st].push(r);
        }
      }
      await tx(Object.keys(STORES), 'readwrite', get => { for (const st of Object.keys(STORES)) { const s = get(st); for (const r of out[st]) s.put(r); } });
      const n = Object.values(out).reduce((a, l) => a + l.length, 0);
      return n;
    },
    async rawSample(store) { return tx(store, 'readonly', s => reqP(s.getAll())); }, // for tests: what is actually on disk
    // ---- data API ----
    allEntries() { return getAll('entries'); },
    async putEntry(e) { return putMany('entries', [e]); },
    putEntries(list) { return putMany('entries', list); },
    deleteEntry(id) { return del('entries', id); },
    clearEntries() { return clr('entries'); },
    async getKV(key, dflt) {
      const r = await tx('kv', 'readonly', s => reqP(s.get(key)));
      if (!r) return dflt;
      const o = await open_('kv', r); return o ? o.value : dflt;
    },
    async setKV(key, value) { return putMany('kv', [{ key, value }]); },
    allML() { return getAll('mlitems'); },
    putML(i) { return putMany('mlitems', [i]); },
    putMLs(list) { return putMany('mlitems', list); },
    deleteML(id) { return del('mlitems', id); },
    clearML() { return clr(['mlitems', 'mlsnaps']); },
    allSnaps() { return getAll('mlsnaps'); },
    putSnap(x) { return putMany('mlsnaps', [x]); },
    putSnaps(list) { return putMany('mlsnaps', list); },
    deleteSnap(id) { return del('mlsnaps', id); },
    allMM() { return getAll('mmitems'); },
    putMM(i) { return putMany('mmitems', [i]); },
    putMMs(list) { return putMany('mmitems', list); },
    deleteMM(id) { return del('mmitems', id); },
    clearMM() { return clr('mmitems'); },
    async clearAll() { await Promise.all(Object.keys(STORES).map(n => tx(n, 'readwrite', s => { s.clear(); }))); encOn = false; dek = null; }
  };
  root.DB = DB;
})(self);
