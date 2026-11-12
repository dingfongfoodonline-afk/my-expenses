# My Expenses — private iPhone expense tracker (PWA)

Static files only. Host this folder on any HTTPS static host (GitHub Pages, Netlify, Cloudflare Pages…),
open the URL in iPhone Safari → Share → Add to Home Screen.

All data (entries, photos, settings) is stored in the phone's browser storage (IndexedDB) for that URL only.
The hosted files contain no data. Keep the same URL forever — a different URL = a different, empty storage.
Use Settings → Export backup regularly; Restore from backup on a new phone/URL.

Files: index.html, style.css, logic.js (pure logic), db.js (IndexedDB), app.js (UI), sw.js (offline), manifest.json, icons/.

## Encryption (v1.3.0, optional — Settings → Security)
- Turning it on creates a random AES-256-GCM data key. Every stored record and photo is encrypted with it, each with a fresh 12-byte IV.
- The data key is never stored in the clear. It is wrapped twice:
  - by your passcode (PBKDF2-SHA256, 600,000 iterations, random salt);
  - by Face ID, using the WebAuthn PRF extension plus HKDF, on devices that support PRF. Otherwise it is passcode-only.
- The app locks at launch and after more than 60 s in the background. The key lives in memory only and is cleared on lock.
- **If you forget the passcode AND lose Face ID access (new phone, reset, credential removed), the data cannot be recovered.** Keep an exported backup.
- Backups are encrypted with a passcode you choose at export by default. Plain JSON export is available with a warning. Import accepts encrypted, plain and older backup formats.
- No network requests are made. A strict Content-Security-Policy is set.
