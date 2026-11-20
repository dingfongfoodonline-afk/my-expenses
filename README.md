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

## Last updated times (v1.6.2)
- At the very top of Main Money and Money Mother, each tab shows two times of its own:
  - **Balance updated · ยอดอัปเดต**: the last change to a total. This covers adding or deleting an entry, changing an amount, marking received/repaid or moving an item back, changing an account balance (including SMS link and Paste), adding or deleting an account that has money in it, and a restore that changes totals.
  - **Other update · อัปเดตอื่นๆ**: the last change that left every total the same. This covers name, note, date, tag, photo, account rename, a 0-balance account, a snapshot, and a restore with the same totals.
- Viewing, reloading, unlocking and exporting never change either time.
- How it works: every database write reports which tab it touched (db.js). The app then compares that tab's totals with the totals at the last change and bumps exactly one of the two times.
- The times are stored with the data, encrypted when encryption is on, and included in backups. Data saved before v1.6.2 starts from the newest account/entry timestamp.
- The exported report header shows both times.

## Several photos per item + Money Mother import file (v1.6.3)
- Each entry can now hold several photos. In the item sheet, the first photo is the main one (list thumbnail and long-press preview). The others show as a row of thumbnails: tap one to view it, × to remove it, or **+ Add photo** to add more (you can pick several photos at once). **Remove** on the main photo promotes the next one, and **Replace** swaps only the main photo.
- The list row shows `📷 4` when an item has 4 photos. Export reports draw every photo in full (receipts are never cropped), with one extra photo card per additional photo.
- Extra photos are encrypted like the main photo and included in backups (`morePhotos`).
- A backup file marked `"partial": ["moneyMother"]` is a Money Mother-only file. Settings → Import shows **Add to Money Mother?** with Add and Cancel only (no Replace). It adds or updates those items by id, so importing the same file twice does not duplicate them, and it never changes Main Money.

## App lock toggle (v1.6.4)
- Settings → Security has one **App lock · ล็อกแอป** switch.
- **Turning it on** the first time asks you to set a passcode (typed twice), then offers Face ID. Your data and photos are then encrypted (AES-256-GCM).
- **Turning it off** needs your current passcode. Face ID alone is not enough. After that the app opens with no unlock screen, and Settings shows: "⚠️ Lock is off: anyone with this phone can open the app."
- **How lock-off storage works:** records and photos stay encrypted on the phone. The data key is kept on the phone (kv `dekOpen`) so the app can open without asking. In practice that is as open as plain storage, which is why the warning is shown. Your passcode and Face ID set-ups are kept, so turning the lock back on only asks for your passcode and then deletes the stored key. Nothing is re-encrypted, so there is no migration risk. If you forgot the passcode while the lock is off, you can set a new one at that point.
- If you had the lock on before v1.6.4, it stays on. Nothing to migrate, and no data changes.

## Google Drive auto-backup (v1.7.0)
- Settings → **Google Drive backup**, then **Auto-backup to Drive**. The one-time Google setup is in `DRIVE-SETUP.md`. The Client ID goes in `drive.js` (`CLIENT_ID`).
- The backup is ONE file, `my-expenses-backup.json`, in your Drive. About 5 s after your last change the app overwrites it by its file ID (PATCH, resumable upload). If you deleted the file, it is created again.
- The file is encrypted on the phone (AES-256-GCM, key from PBKDF2-SHA256 with 600k rounds) using your app passcode (lock on) or a backup passcode set at Drive setup (lock off). It is the same format as an encrypted export, so **Restore from backup…** with the file and passcode also works.
- Settings shows **Last Drive backup** (time and status). **Restore from Drive…** asks for the passcode, shows a preview of the counts, then replaces everything.
- Sign-in uses Google Identity Services (token client, `drive.file` scope). Expired tokens are renewed silently when possible. Otherwise **Reconnect Drive** appears, and the pending change is uploaded after you reconnect.
- The CSP is relaxed only for accounts.google.com, apis.google.com, www.googleapis.com and oauth2.googleapis.com. Nothing contacts Google until you turn the backup on.

## Balance & pending history, moving items (v1.7.1)
- **Balance history · ประวัติยอดเงิน:** whenever an account balance or the Main Money **Pending · รอรับ** total changes, the app logs a row: time, account, old → new, change and the cause. Causes include manual edit, KBank SMS, an entry being added, edited, received, deleted or moved, an import or a restore.
  - Open it by tapping the "Balance updated" line, the Total, the 📈 button, or the Pending box (which opens Pending history).
  - Newest first, grouped by day, with a filter by account. Increases show in green, decreases in red, with a line chart.
- **Pending updated · อัปเดตรอรับ:** a third time on the Main Money stamp line, showing when the Pending total last changed.
- The history lives in the encrypted vault (kv `history`). It is part of backups, Drive backups and restores. When you upgrade from an older version, one starting row is created per account plus one for Pending.
- **Move between Main Money and Money Mother:** in an item's edit sheet, tap "↔ Move to Money Mother" or "↔ Move to Main Money". Photos, date, note and amount are kept, and the status becomes Owed or Pending.
  - Main Money entries don't belong to an account, so no account question is asked.
  - If a received Main entry had been added to the bank, you can subtract it while moving.
