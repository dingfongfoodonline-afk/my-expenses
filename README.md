# My Expenses — private iPhone expense tracker (PWA)

Static files only. Host this folder on any HTTPS static host (GitHub Pages, Netlify, Cloudflare Pages…),
open the URL in iPhone Safari → Share → Add to Home Screen.

All data (entries, photos, settings) is stored in the phone's browser storage (IndexedDB) for that URL only.
The hosted files contain no data. Keep the same URL forever — a different URL = a different, empty storage.
Use Settings → Export backup regularly; Restore from backup on a new phone/URL.

Files: index.html, style.css, logic.js (pure logic), db.js (IndexedDB), app.js (UI), sw.js (offline), manifest.json, icons/.
