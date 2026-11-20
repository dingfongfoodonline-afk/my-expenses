# Google Drive backup: one-time setup (about 10 minutes)

My Money backs up to your own Google Drive. For that, Google needs a "Client ID" that says
"this app at https://dingfongfoodonline-afk.github.io is allowed to ask for Drive access".
You make it once, for free, in Google Cloud. You don't need a credit card.

## 1. Create a Google Cloud project
1. On your computer, open https://console.cloud.google.com/ and sign in with **your Gmail**.
2. At the top, click the project picker, then **New project**.
3. Name: `My Money`. Click **Create** and wait a few seconds. Make sure `My Money` is selected at the top.

## 2. Turn on the Google Drive API
1. Open the menu ☰, then **APIs & Services**, then **Library**.
2. Search for **Google Drive API**, open it and click **Enable**.

## 3. Consent screen (Testing mode, only you)
1. Open ☰, then **APIs & Services**, then **OAuth consent screen**. Newer consoles call this **Google Auth Platform**, then **Branding / Audience**.
2. Click **Get started** (or **Configure consent screen**).
   - App name: `My Money`
   - User support email: your Gmail
   - Audience / User type: **External**
   - Contact email: your Gmail
   Agree and click **Create** (or Save).
3. **Audience**, then **Test users**: click **Add users**, type **your Gmail address** and save.
   Leave the publishing status as **Testing**. That way only the test users you add can sign in, and you don't need Google's review.
4. **Data access** (or "Scopes"): click **Add or remove scopes** and tick
   `.../auth/drive.file` ("See, edit, create and delete only the specific Google Drive files you use with this app"). Save.

## 4. Create the Web client ID
1. Open ☰, then **APIs & Services**, then **Credentials**. Click **+ Create credentials**, then **OAuth client ID**.
2. Application type: **Web application**. Name: `My Money web`.
3. Under **Authorized JavaScript origins**, click **+ Add URI** and enter exactly:
   `https://dingfongfoodonline-afk.github.io`
   Don't add a path or a trailing slash. You don't need any redirect URIs.
4. Click **Create** and copy the **Client ID**. It looks like `1234567890-abc123.apps.googleusercontent.com`. You don't need the client secret.

## 5. Put the Client ID into the app
1. Open `drive.js` and replace the placeholder on this line:
   `const CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';`
   with your Client ID, keeping the quotes.
2. Deploy as usual. The Client ID is not a secret, so it is fine to have it in the public repo.

## 6. Turn it on in the app (on your iPhone)
1. Open My Money, go to **Settings**, then **Google Drive backup**, and switch on **Auto-backup to Drive**.
2. Passcode for the backup file:
   - With **App lock on**, the backup uses your app passcode.
   - With **App lock off**, you set a separate backup passcode (typed twice).
   You need this passcode to restore. Google only ever stores the encrypted file.
3. Tap **Continue with Google**, choose your Gmail, and allow access.
   - Google will show an "unverified app" warning. That is normal in Testing mode: tap **Continue**.
4. Done. **Last Drive backup** shows the time. After every change, the app replaces the one file `my-expenses-backup.json` in your Drive about 5 seconds later.

## Good to know
- **Access:** the app can only see files it created (`drive.file`). It can't read the rest of your Drive.
- **Sign-in renewal:** Google sign-ins last about an hour. The app renews quietly when it can. If it can't (for example after a long time closed), Settings shows **Reconnect Drive**. Tap it once and the waiting change is uploaded.
- **Restore** (for example on a new phone): go to Settings, tap **Restore from Drive…**, sign in, and enter the backup passcode. You see a preview of the counts first, then everything on the phone is replaced.
- **Testing mode and re-sign-in:** Google may ask you to sign in again every 7 days. That is just a Reconnect tap. To avoid it you could publish the app, but for one person Testing is simpler.
- **Turning it off:** the file stays in your Drive until you delete it there.
