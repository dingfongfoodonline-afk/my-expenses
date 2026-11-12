/* Tiny IndexedDB wrapper. All data stays in this browser on this device. */
(function (root) {
  'use strict';
  const DB_NAME = 'my-expenses';
  const DB_VER = 2;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('entries')) {
          const s = db.createObjectStore('entries', { keyPath: 'id' });
          s.createIndex('ts', 'ts');
        }
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('mlitems')) db.createObjectStore('mlitems', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('mlsnaps')) db.createObjectStore('mlsnaps', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbp = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database blocked — close other tabs of this app.'));
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s, t)).then(r => { result = r; }, reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    }));
  }
  function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  const DB = {
    open,
    allEntries() { return tx('entries', 'readonly', s => reqP(s.getAll())); },
    getEntry(id) { return tx('entries', 'readonly', s => reqP(s.get(id))); },
    putEntry(e) { return tx('entries', 'readwrite', s => { s.put(e); }); },
    putEntries(list) { return tx('entries', 'readwrite', s => { for (const e of list) s.put(e); }); },
    deleteEntry(id) { return tx('entries', 'readwrite', s => { s.delete(id); }); },
    clearEntries() { return tx('entries', 'readwrite', s => { s.clear(); }); },
    getKV(key, dflt) { return tx('kv', 'readonly', s => reqP(s.get(key))).then(r => (r ? r.value : dflt)); },
    setKV(key, value) { return tx('kv', 'readwrite', s => { s.put({ key, value }); }); },
    allML() { return tx('mlitems', 'readonly', s => reqP(s.getAll())); },
    putML(i) { return tx('mlitems', 'readwrite', s => { s.put(i); }); },
    putMLs(list) { return tx('mlitems', 'readwrite', s => { for (const i of list) s.put(i); }); },
    deleteML(id) { return tx('mlitems', 'readwrite', s => { s.delete(id); }); },
    clearML() { return Promise.all([tx('mlitems', 'readwrite', s => { s.clear(); }), tx('mlsnaps', 'readwrite', s => { s.clear(); })]); },
    allSnaps() { return tx('mlsnaps', 'readonly', s => reqP(s.getAll())); },
    putSnap(x) { return tx('mlsnaps', 'readwrite', s => { s.put(x); }); },
    putSnaps(list) { return tx('mlsnaps', 'readwrite', s => { for (const x of list) s.put(x); }); },
    deleteSnap(id) { return tx('mlsnaps', 'readwrite', s => { s.delete(id); }); },
    clearAll() { return Promise.all(['entries', 'kv', 'mlitems', 'mlsnaps'].map(n => tx(n, 'readwrite', s => { s.clear(); }))); }
  };
  root.DB = DB;
})(self);
