# FEU Bataan eRFA — Setup Checklist

Do these once, in order. About 1 hour in total. Each part says **who** does it.

| Thing | Value |
|---|---|
| Website | `https://feubataan.github.io/feu-bataan-erfa/` |
| GitHub account / repository | `FeuBataan` / `feu-bataan-erfa` |
| Microsoft 365 domain | `uncbataan.edu.ph` |
| Mailbox that sends eRFA emails | `erfa@uncbataan.edu.ph` (already exists) |
| Sign-in | Microsoft 365 single sign-on: staff already signed in to Outlook or Teams go straight in |
| Database and attachments | Google Sheets + Google Drive in a campus Google account |

**Never paste the client secret into chat, email, GitHub or the spreadsheet.** It goes only into Apps Script → Script Properties (step 2.5).

---

## 1. Microsoft 365 — IT administrator (about 20 minutes)

Needs a Global Administrator or Application Administrator. The `erfa@` account itself is not an admin.

**1.1 Register the app.** Open <https://entra.microsoft.com> → **Applications → App registrations → New registration**:
- Name: `eRFA`
- Supported account types: **Accounts in this organizational directory only (single tenant)**
- Redirect URI: platform **Single-page application (SPA)**, value `https://feubataan.github.io/feu-bataan-erfa/auth-redirect.html`
- Click **Register**. From the Overview page copy the **Application (client) ID** and the **Directory (tenant) ID**. These two are not secret.

**1.2 Permissions.** In the app → **API permissions**:
- `Microsoft Graph → User.Read` (Delegated) is already there. Keep it. It lets eRFA read the signed-in person's name and email.
- **Add a permission → Microsoft Graph → Application permissions → `Mail.Send`**.
- Click **Grant admin consent for (your organization)**. Both rows should show a green check.

**1.3 Secret.** In the app → **Certificates & secrets → New client secret**:
- Description `eRFA mail`, expires **24 months**.
- Copy the **Value** column right away; it is shown only once. You will paste it in step 2.5.
- Put a calendar reminder 2 weeks before the expiry date. See "Renewing the secret" at the end.

**1.4 Allow sending only from erfa@.** Without this step, `Mail.Send` could send as any mailbox. Run in PowerShell as an Exchange admin (replace `<CLIENT-ID>`):

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser
```
```powershell
Connect-ExchangeOnline
```
```powershell
New-DistributionGroup -Name "eRFA Senders" -Alias erfasenders -Type Security -Members erfa@uncbataan.edu.ph
```
```powershell
New-ApplicationAccessPolicy -AppId <CLIENT-ID> -PolicyScopeGroupId erfasenders@uncbataan.edu.ph -AccessRight RestrictAccess -Description "eRFA may send only as erfa@uncbataan.edu.ph"
```

After about 30 minutes, check it. The first command should say `Granted`, the second `Denied`:

```powershell
Test-ApplicationAccessPolicy -Identity erfa@uncbataan.edu.ph -AppId <CLIENT-ID>
```
```powershell
Test-ApplicationAccessPolicy -Identity <any-other-staff>@uncbataan.edu.ph -AppId <CLIENT-ID>
```

**1.5 Staff list.** Microsoft 365 admin center <https://admin.microsoft.com> → **Users → Active users → Export users** → save the CSV. You will import it in step 5.

## 2. Google Apps Script — database owner (about 15 minutes)

Use one campus-owned Google account (for example a new Gmail made for eRFA) with **2-Step Verification on** and a backup admin. This account owns the database and attachments.

1. <https://script.google.com> → **New project** → name it `FEU Bataan eRFA`. Copy the **Script ID** from Project Settings and send it to the developer.
2. The developer uploads the code (`pnpm --filter @erfa/apps-script push`, with `apps-script/.clasp.json` holding the Script ID).
3. In the editor, choose **`setupDatabase`** → **Run** and approve the permissions. The log shows the database spreadsheet link.
4. **Deploy → New deployment → Web app**: *Execute as* **Me**, *Who has access* **Anyone**. Copy the `/exec` URL. Later updates: Manage deployments → Edit → New version, so the URL never changes.
5. **Project Settings → Script Properties → Add script property**: name `MS_CLIENT_SECRET`, value = the secret from step 1.3. This is the only place the secret goes.

## 3. Database settings — developer or admin

In the database spreadsheet → `SETTINGS` sheet:

| Key | Value |
|---|---|
| `MS_TENANT_ID` | Directory (tenant) ID from 1.1 |
| `MS_CLIENT_ID` | Application (client) ID from 1.1 |
| `MAIL_SENDER` | `erfa@uncbataan.edu.ph` |
| `ALLOWED_DOMAIN` | `uncbataan.edu.ph` (already filled in) |
| `FRONTEND_URL` | `https://feubataan.github.io/feu-bataan-erfa` (no trailing slash) |
| `MAIL_FALLBACK_TO_GOOGLE` | `TRUE` (if Outlook ever fails, the email still goes out through Google) |

Then in the Apps Script editor:
- Choose **`testOutlookEmail`** → **Run**. A test email should arrive in the `erfa@` mailbox. If it fails, the log names what is missing.
- Create the first administrator. Add a file **Bootstrap.gs** with the admin's real school email and name, run `runBootstrap` once, then delete the file:

```js
function runBootstrap() {
  bootstrapAdmin('admin@uncbataan.edu.ph', 'Administrator Name');
}
```

## 4. GitHub — repository owner (about 5 minutes)

1. Signed in as **FeuBataan**, create an **empty** repository `feu-bataan-erfa` (no README). The developer pushes the code.
2. **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables**, add:

| Variable | Value |
|---|---|
| `VITE_API_URL` | the `/exec` URL from 2.4 |
| `VITE_MS_CLIENT_ID` | Application (client) ID |
| `VITE_MS_TENANT_ID` | Directory (tenant) ID |

4. **Actions → Check and deploy FEU Bataan eRFA frontend → Run workflow**. When it finishes, open the website.

## 5. First sign-in and staff — eRFA administrator

1. Open the website and **Sign in with Microsoft** using the bootstrapped admin account.
2. **Administration → Users → Add staff from Microsoft 365**: choose the CSV from step 1.5. Untick students, shared mailboxes and anything not staff, check the count, then **Import**. Everyone imported can create RFAs. Run it again any time; existing people are updated, never deleted.
3. **Administration → Departments**: mark academic departments, set each department head, and make sure procurement has code `PPU` or "Procurement" in its name.
4. **Administration → Users**: tick **Approve** for approvers.
5. **Administration → Official Approval Settings**: choose each official:
   - Reviewed and Noted (mandatory)
   - Approved By: Finance official (emailed first), then VP for Admin and Finance
   - VP for Academic Affairs
   - President, and the threshold amount
   - JHS/SHS Principal (optional)

## 6. Before going live

- [ ] File a test RFA through every approver: submit → each approval → Approved → Implementation → Closed.
- [ ] The emails arrive **from erfa@uncbataan.edu.ph** and their links open the RFA.
- [ ] The `NOTIFICATIONS` sheet has no `FAILED` rows.
- [ ] Replace the placeholder logo: `frontend/public/school-logo.svg`, `school-logo-light.svg` and `favicon.svg`.
- [ ] Add the administrator contact to `frontend/public/privacy.html` under "Questions and requests".
- [ ] Clear the test RFAs with the reset tool in [MAINTENANCE.md](MAINTENANCE.md).

---

### Renewing the secret (every 24 months)

Entra → eRFA app → Certificates & secrets → **New client secret** → copy the Value. Replace `MS_CLIENT_SECRET` in Apps Script Script Properties, run `testOutlookEmail`, then delete the old secret. If it expires unnoticed, emails go out through Google and nothing is lost, but `[eRFA]` emails come from the Google account instead of `erfa@`.

### If something goes wrong

| Message | Fix |
|---|---|
| "eRFA has not been approved in your school Microsoft 365 yet" | Step 1.2: Grant admin consent. |
| "The Microsoft sign-in window was blocked" | Allow pop-ups for the eRFA site. |
| "Your account (…) is not registered in eRFA" | Add the person in Administration → Users, or import them. |
| "Microsoft sign-in is not configured" | Step 3: `MS_TENANT_ID` and `MS_CLIENT_ID`. |
| `testOutlookEmail`: "Access is denied" or "ErrorAccessDenied" | Step 1.4 is not applied yet (wait up to an hour), or `MAIL_SENDER` is not in the "eRFA Senders" group. |
| `testOutlookEmail`: "Outlook sign-in failed" | Wrong or expired secret in Script Properties (step 2.5). |
