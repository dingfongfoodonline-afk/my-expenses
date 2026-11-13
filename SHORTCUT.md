# Update a balance from KBank SMS (iOS Shortcuts)

The app runs as a home-screen web app. Read this before setting anything up:

> **On iOS a home-screen web app has its own storage, separate from Safari.**
> A Shortcut that does `Open URLs https://…/my-expenses/?setbal=…` opens **Safari**. That updates Safari's copy of the app, not the one on your Home Screen.

So the recommended setup moves the SMS through the **clipboard** and opens the home-screen app. You then confirm with two taps. The app never changes a balance without your confirmation.

## Recommended: clipboard + Paste button (works with the home-screen app)

1. Open **Shortcuts**, go to **Automation**, tap **+** (New Automation), then choose **Message**.
2. **Sender**: choose the KBank sender. Check the exact sender name in Messages; it is usually `KBank`.
3. **Message Contains**: `เหลือ`
4. Choose **Run Immediately** and turn **Notify When Run** off if you like. Tap **Next**, then **New Blank Automation**.
5. Add the action **Copy to Clipboard**. Tap its input, choose **Shortcut Input**, then tap it again and pick **Content** (the message text).
6. Add the action **Open URLs** with this URL:
   `webapp://dingfongfoodonline-afk.github.io/my-expenses/`
   This opens the installed home-screen app, not Safari. It must match the address you used when you added the app to the Home Screen, including the trailing `/`.
7. Optional fallback: add **Show Notification** with the text "Open My Expenses → 📋 Paste KBank SMS".
8. Tap **Done**.

When an SMS arrives, My Expenses opens. Unlock it with Face ID if it is encrypted. Then:

- Tap **📋 Paste KBank SMS** on the balance card.
- iOS shows a small **Paste** bubble. Tap it.
- The app reads the number after `เหลือ` and asks: *Update เงินในธนาคาร to ฿X? (from KBank SMS 23:08)*. Tap **Update**.

To update a different account, open that account (tap it in the card), tap **📋 Paste balance from KBank SMS**, then tap **Save**.

## Alternative: URL handler (only for the Safari copy of the app)

This works only if you use the app in a normal Safari tab, or if the `webapp://` link on your iOS version passes the query string through (untested). Find the URL under **Settings → 📩 SMS auto-update**.

1. Set up the same automation as steps 1–4 above.
2. **Receive Shortcut Input**: use Shortcut Input, then **Content**.
3. **Match Text**: `เหลือ\s*([\d,\.]+)` in the Content.
4. **Get Group At Index** 1 in the Matches.
5. **Replace Text**: replace `,` with nothing in the Group.
6. **URL**: `https://dingfongfoodonline-afk.github.io/my-expenses/?setbal=[Updated Text]&acct=เงินในธนาคาร&src=kbank-sms`
7. **Open URLs**.

The app also accepts `?sms=<URL-encoded full SMS>` and parses it itself. If `acct` doesn't match an account name, the first Bank account is used. Amounts that can't be read show a message and change nothing.

## iOS caveats

- **Separate storage.** Safari and the home-screen app never share data. Use the clipboard flow for the home-screen app.
- **`webapp://`** is an undocumented iOS behaviour. Users report it works on iOS 17 and 18. If it opens the wrong web app or nothing happens, delete that action and rely on the notification, then open the app yourself.
- **Paste needs a tap.** Web apps can read the clipboard only after a tap, and iOS shows the Paste bubble each time. That is why the update can't be fully automatic.
- **Locked phone.** Message automations can run while the phone is locked, but opening an app waits until you unlock.
- **Clipboard is overwritten.** The automation replaces whatever you had copied.
- **Sender name.** If the automation never fires, check the sender name exactly as it appears in Messages.
- **Masked samples** (`เหลือ xxบ`) contain no number and are ignored.
- **Testing.** None of this has been tested on a real iPhone. Try it once with a real SMS and check the amount before tapping Update.
