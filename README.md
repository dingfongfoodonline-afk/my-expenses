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

## Accounts (v1.4.0)
- The balance card holds a list of accounts. Each has a name, a type (Bank ธนาคาร / Cash เงินสด), a balance and its own last-updated time. The time is set only when that balance changes.
- Use "+ Add account · เพิ่มบัญชี" to add one. Tap an account to edit it. Swipe left or use the header Delete to remove it. The last account can't be deleted.
- รวม = all accounts + pending entries. "Received + add to bank" goes to the first Bank account.
- The old single bank balance migrates to an account named เงินในธนาคาร and keeps its timestamp. Accounts are stored encrypted when encryption is on.
- Backups are format 4 and include accounts. Older backups (single bank, grouped) still import.

## KBank SMS (v1.5.0)
- **📋 Paste KBank SMS** on the balance card, or in an account's sheet, reads the clipboard. It parses the balance after `เหลือ` and asks before updating.
- Links like `?setbal=1234.56&acct=<name>&src=kbank-sms` or `?sms=<SMS text>` show a confirm after unlock, then clear the query string.
- Find the helper URL under Settings → SMS auto-update.
- See SHORTCUT.md for the iOS Shortcuts setup and caveats. Home-screen apps don't share storage with Safari.

## Money Mother (v1.6.0)
- The second tab logs money you spent for your mother and should get back. Each item has a name, amount, date (defaults to today), and an optional note and photo.
- Tap the circle to mark an item repaid, and tap it again to move it back to owed. Swipe left or use the header Delete to remove an item. Press and hold an item to preview its photo.
- The card shows **Mom owes** (outstanding) and **Repaid**. These totals are completely separate from Main Money's รวม and the bank accounts.
- Items live in their own IndexedDB store (`mmitems`, DB v3; the upgrade is additive). They are encrypted with the same data key when encryption is on, and included in backups (format 5). Older backups without Money Mother still import.

## Export report (v1.6.0)
- **Export report** on both tabs draws a designed PNG on the device with `<canvas>` (`export.js`). It has a summary header, then a card per entry with its photo, amount and date/time.
- Thai text uses the system fonts. No network, nothing uploaded.
- On iPhone the share sheet saves or sends the image. Elsewhere it downloads. **Print / PDF** prints the same image through a print stylesheet.

## Updates & export fixes (v1.6.1)
- Fixed "Export does nothing" on iPhone: the old service worker could run a new `index.html` with an old cached `app.js`. The service worker now keeps one versioned cache. It installs atomically, checking that every file has the matching version, and serves the cached `index.html`. The app checks that its page, `app.js` and `export.js` versions match; if they don't, it clears the caches and reloads once.
- New versions apply automatically: the app checks for an update each time it comes to the foreground and reloads once the update is ready.
- Export shows a "Creating report…" dialog straight away, and any error appears in a dialog or toast instead of failing silently.
- Big reports are split into several PNG pages so they stay inside iOS canvas limits. Photos are decoded one page at a time, and Share/Download/Print handle all the pages.
- Deploy tip: upload all files in one commit, or upload `sw.js` last.
