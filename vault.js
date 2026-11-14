/* Vault: on-device encryption for My Money. AES-256-GCM data key (DEK), wrapped by
   (1) a passcode via PBKDF2-SHA256 (600k) and optionally (2) Face ID via the WebAuthn PRF extension + HKDF.
   No network, no server. The DEK lives only in memory while unlocked. */
(function (root) {
  'use strict';
  const C = (root.crypto || {}).subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  const PBKDF2_ITER = 600000;
  const rand = n => root.crypto.getRandomValues(new Uint8Array(n));
  const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

  async function passKEK(passcode, salt, iter) {
    const base = await C.importKey('raw', te.encode(passcode), 'PBKDF2', false, ['deriveKey']);
    return C.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter || PBKDF2_ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']);
  }
  async function prfKEK(prfOut, hkdfSalt) {
    const base = await C.importKey('raw', prfOut, 'HKDF', false, ['deriveKey']);
    return C.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: hkdfSalt, info: te.encode('my-money/dek-wrap/v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
  }
  const genDEK = () => C.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  async function wrap(dek, kek) { const iv = rand(12); const ct = await C.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv }); return { iv: b64(iv), ct: b64(ct) }; }
  async function unwrap(w, kek) {
    try { return await C.unwrapKey('raw', unb64(w.ct), kek, { name: 'AES-GCM', iv: unb64(w.iv) }, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']); }
    catch (_) { const e = new Error('Wrong passcode or key'); e.code = 'BADKEY'; throw e; }
  }
  async function encBytes(key, bytes) { const iv = rand(12); const ct = await C.encrypt({ name: 'AES-GCM', iv }, key, bytes); return { iv, ct }; }
  async function decBytes(key, iv, ct) {
    try { return await C.decrypt({ name: 'AES-GCM', iv }, key, ct); }
    catch (_) { const e = new Error('Decryption failed'); e.code = 'BADKEY'; throw e; }
  }

  // ---- passcode wrapping ----
  async function wrapWithPasscode(dek, passcode) {
    const salt = rand(16); const kek = await passKEK(passcode, salt, PBKDF2_ITER);
    return { kdf: 'PBKDF2-SHA256', iter: PBKDF2_ITER, salt: b64(salt), wrapped: await wrap(dek, kek) };
  }
  async function unwrapWithPasscode(p, passcode) { return unwrap(p.wrapped, await passKEK(passcode, unb64(p.salt), p.iter)); }

  // ---- Face ID (WebAuthn PRF) ----
  function webauthnAvailable() { return !!(root.PublicKeyCredential && navigator.credentials && navigator.credentials.create); }
  async function platformAvailable() {
    try { return webauthnAvailable() && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (_) { return false; }
  }
  async function prfGet(credId, prfSalt) {
    const cred = await navigator.credentials.get({ publicKey: { challenge: rand(32), rpId: location.hostname, userVerification: 'required', timeout: 60000,
      allowCredentials: [{ type: 'public-key', id: unb64(credId), transports: ['internal', 'hybrid'] }], extensions: { prf: { eval: { first: unb64(prfSalt) } } } } });
    const r = cred && cred.getClientExtensionResults && cred.getClientExtensionResults();
    const out = r && r.prf && r.prf.results && r.prf.results.first;
    if (!out) { const e = new Error('This device does not support Face ID key derivation (WebAuthn PRF).'); e.code = 'NOPRF'; throw e; }
    return out;
  }
  // Enroll: create a platform credential with PRF, derive a wrap key, wrap DEK. Returns {prf record} or throws NOPRF.
  async function enrollFaceID(dek) {
    const prfSalt = rand(32), hkdfSalt = rand(16);
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { id: location.hostname, name: 'My Money' }, user: { id: rand(16), name: 'my-money', displayName: 'My Money' }, challenge: rand(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], timeout: 60000, attestation: 'none',
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      extensions: { prf: { eval: { first: prfSalt } } } } });
    const ext = cred.getClientExtensionResults ? cred.getClientExtensionResults() : {};
    if (!ext.prf || ext.prf.enabled === false) { const e = new Error('Face ID key derivation (WebAuthn PRF) is not supported on this device.'); e.code = 'NOPRF'; throw e; }
    const credId = b64(cred.rawId);
    let out = ext.prf.results && ext.prf.results.first;
    if (!out) out = await prfGet(credId, b64(prfSalt)); // some platforms only return PRF output on get()
    const kek = await prfKEK(out, hkdfSalt);
    return { credId, prfSalt: b64(prfSalt), hkdfSalt: b64(hkdfSalt), wrapped: await wrap(dek, kek) };
  }
  async function unwrapWithFaceID(p) {
    const out = await prfGet(p.credId, p.prfSalt);
    return unwrap(p.wrapped, await prfKEK(out, unb64(p.hkdfSalt)));
  }

  // ---- record encryption (Blobs encrypted separately) ----
  const BLOB_FIELDS = ['photo', 'thumb'];
  const BLOB_LISTS = ['morePhotos']; // v1.6.3: extra photos of one item (Blob[])
  async function encryptRecord(dek, rec, keyField) {
    const plain = {}, blobs = {};
    for (const k of Object.keys(rec)) {
      const v = rec[k];
      if (k === keyField) continue;
      if (BLOB_FIELDS.includes(k) && v instanceof Blob) {
        const { iv, ct } = await encBytes(dek, await v.arrayBuffer());
        blobs[k] = { iv, ct, type: v.type || 'image/jpeg' };
      } else if (BLOB_LISTS.includes(k) && Array.isArray(v) && v.length && v.every(b => b instanceof Blob)) {
        const list = [];
        for (const b of v) { const { iv, ct } = await encBytes(dek, await b.arrayBuffer()); list.push({ iv, ct, type: b.type || 'image/jpeg' }); }
        blobs[k] = list;
      } else plain[k] = v;
    }
    const { iv, ct } = await encBytes(dek, te.encode(JSON.stringify(plain)));
    return { [keyField]: rec[keyField], _enc: 1, iv, ct, blobs };
  }
  async function decryptRecord(dek, r, keyField) {
    if (!r || !r._enc) return r;
    const obj = JSON.parse(td.decode(await decBytes(dek, r.iv, r.ct)));
    obj[keyField] = r[keyField];
    for (const k of Object.keys(r.blobs || {})) {
      const b = r.blobs[k];
      if (Array.isArray(b)) { const list = []; for (const x of b) list.push(new Blob([await decBytes(dek, x.iv, x.ct)], { type: x.type })); obj[k] = list; }
      else obj[k] = new Blob([await decBytes(dek, b.iv, b.ct)], { type: b.type });
    }
    return obj;
  }

  // ---- passcode-encrypted backup file ----
  async function encryptBackup(text, passcode) {
    const salt = rand(16); const key = await passKEK(passcode, salt, PBKDF2_ITER);
    const { iv, ct } = await encBytes(key, te.encode(text));
    return { app: 'my-expenses', encrypted: true, format: 'enc1', cipher: 'AES-256-GCM', kdf: { name: 'PBKDF2-SHA256', iter: PBKDF2_ITER, salt: b64(salt) }, iv: b64(iv), ct: b64(ct) };
  }
  async function decryptBackup(obj, passcode) {
    const key = await passKEK(passcode, unb64(obj.kdf.salt), obj.kdf.iter);
    try { return td.decode(await C.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) }, key, unb64(obj.ct))); }
    catch (_) { const e = new Error('Wrong passcode for this backup'); e.code = 'BADKEY'; throw e; }
  }

  root.Vault = { PBKDF2_ITER, available: !!C, genDEK, wrapWithPasscode, unwrapWithPasscode, webauthnAvailable, platformAvailable, enrollFaceID, unwrapWithFaceID,
    encryptRecord, decryptRecord, encryptBackup, decryptBackup, b64, unb64 };
})(self);
