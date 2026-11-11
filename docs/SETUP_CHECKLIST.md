# FEU Bataan eRFA — Setup Checklist

Do these steps once, in order. They use your own Google and GitHub accounts, so nothing here has been done for you yet.

Names used below (change them if you like, but keep them consistent):

| Thing | Value |
|---|---|
| GitHub repository | `feu-bataan-erfa` |
| Website address | `https://<github-user>.github.io/feu-bataan-erfa/` |
| Google Workspace domain | `feu.edu.ph` |

Tip: sign in to Google with an **@feu.edu.ph** account for every Google step, so the database, Drive files and emails belong to the campus.

---

## 1. GitHub repository (website code)

1. On GitHub, create a new **empty** repository named `feu-bataan-erfa` (no README, no licence).
2. In this folder, connect and push:
   ```bash
   git remote add origin https://github.com/<github-user>/feu-bataan-erfa.git
   git push -u origin main
   ```
3. Repository **Settings → Pages → Source: GitHub Actions**.
4. The first workflow run will fail or show "not configured" until step 5 is done. That is expected.

## 2. Apps Script project (backend)

1. Go to <https://script.google.com> → **New project**. Name it `FEU Bataan eRFA`.
2. Project Settings → copy the **Script ID**.
3. In `apps-script/`, copy `.clasp.json.example` to `.clasp.json` and paste the Script ID (this file is git-ignored).
4. Upload the code (needs `npm i -g @google/clasp` and `clasp login` once):
   ```bash
   pnpm --filter @erfa/apps-script push
   ```
   Without clasp: run `pnpm --filter @erfa/apps-script build`, then paste `apps-script/dist/Code.js` and `apps-script/dist/appsscript.json` into the editor (show the manifest under Project Settings).
5. In the editor, select **`setupDatabase`** → **Run**. Approve the Sheets, Drive, Mail and external-request permissions. The log shows the new database spreadsheet URL. Open it and keep the tab.
6. **Deploy → New deployment → Web app**: *Execute as:* Me, *Who has access:* Anyone. Copy the `/exec` URL. This is `VITE_API_URL`.
   Later backend updates: edit this same deployment (Manage deployments → Edit → New version) so the URL never changes.

## 3. Google Cloud: OAuth client and consent screen

1. Open <https://console.cloud.google.com> → create a project `FEU Bataan eRFA`.
2. **APIs & Services → OAuth consent screen**:
   - User type: **Internal** if every user has an @feu.edu.ph account and this project belongs to the feu.edu.ph organisation. Choose **External** (then **Publish app → In production**) if any approver signs in with a non-feu.edu.ph account.
   - App name `eRFA – FEU Bataan Campus`, support email, logo (optional).
   - Privacy policy URL: `https://<github-user>.github.io/feu-bataan-erfa/privacy.html`.
   - Scopes: only the defaults (`openid`, `email`, `profile`).
3. **Credentials → Create credentials → OAuth client ID → Web application**:
   - Authorized JavaScript origins: `https://<github-user>.github.io` (and `http://localhost:5173` for local testing).
   - No redirect URI and no client secret needed.
   - Copy the **Client ID**. This is `VITE_GOOGLE_CLIENT_ID`.

## 4. Database settings

In the database spreadsheet → `SETTINGS` sheet, set:

| Key | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | the Client ID from step 3 |
| `FRONTEND_URL` | `https://<github-user>.github.io/feu-bataan-erfa` (no trailing slash) |
| `ALLOWED_DOMAIN` | `feu.edu.ph` — leave blank if approvers from other domains must sign in |

Then create the first administrator. In the Apps Script editor, add a file **Bootstrap.gs** with the real admin's email and name:

```js
function runBootstrap() {
  bootstrapAdmin('admin@feu.edu.ph', 'Administrator Name');
}
```

Select `runBootstrap` → **Run** once, then delete Bootstrap.gs (the next `clasp push` would remove it anyway).

## 5. GitHub repository variables

Repository **Settings → Secrets and variables → Actions → Variables → New repository variable**:

| Variable | Value |
|---|---|
| `VITE_API_URL` | the `/exec` URL from step 2.6 |
| `VITE_GOOGLE_CLIENT_ID` | the Client ID from step 3.3 |
| `VITE_BASE_PATH` | `/feu-bataan-erfa/` (use `/` for a custom domain) |

Then **Actions → Check and deploy FEU Bataan eRFA frontend → Run workflow**. When it finishes, open the website address.

## 6. First sign-in and campus data

1. Sign in with the bootstrapped admin account.
2. **Administration → Departments**: add the campus departments and mark academic ones. Use code `PPU` (or a name containing "Procurement") for the procurement office.
3. **Administration → Users**: add users (or use the import tool) and tick who can create and who can approve RFAs. Set department heads.
4. **Administration → Official Approval Settings** — choose each official from the user list:
   - Reviewed and Noted mandatory
   - Approved mandatory — Finance official (emailed first)
   - Approved mandatory — VP for Admin and Finance
   - VP for Academic Affairs (academic departments)
   - President (at or above the threshold) and the threshold amount
   - JHS/SHS Principal (optional)

   RFAs cannot be submitted until the Reviewed and Noted and Approved By officials are set.

## 7. Before going live

- [ ] File a test RFA end to end with test accounts: submit → each approver → Approved → Implementation → Closed.
- [ ] Check that notification emails arrive and their links open the RFA.
- [ ] Check the `NOTIFICATIONS` sheet for `FAILED` rows.
- [ ] Replace the placeholder logo: `frontend/public/school-logo.svg` (white backgrounds), `school-logo-light.svg` (green sidebar), `favicon.svg`. Keep the file names, or update the references in `LoginPage.tsx`, `components.tsx` and `RfaDetailPage.tsx` if you use PNG.
- [ ] Add an administrator contact (email or office) to `frontend/public/privacy.html` under "Questions and requests".
- [ ] To clear test RFAs before launch, use the RFA reset tool described in [MAINTENANCE.md](MAINTENANCE.md).
