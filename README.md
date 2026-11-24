# eRFA - UNC Bataan

Electronic Request for Approval system for UNC Bataan. It preserves the supplied institutional RFA fields and approval terminology while adding authenticated routing, email notifications, Drive attachments, dashboards, print/PDF output, and append-only history.

## Architecture

- **Frontend:** React 19, TypeScript, Vite; deployable to GitHub Pages
- **API:** Google Apps Script Web App using a small JSON RPC envelope over `fetch()`
- **Identity:** Microsoft 365 single sign-on (MSAL, Microsoft Entra app registration). The backend confirms each Microsoft Graph token by reading the user's own profile, and accepts only this school's tenant and app. Google sign-in remains available as an option.
- **Data:** Google Sheets initialized safely by `setupDatabase()`
- **Files:** private Google Drive folders by year and RFA number
- **Email:** sent from the school Outlook mailbox through Microsoft Graph (`MAIL_SENDER`), falling back to Google `MailApp`, with notification status and error logging

The project contains no production users, departments, approvers, IDs, URLs, or secrets.

## Local quality checks

Use Node.js 20 or newer:

```bash
pnpm install
pnpm check
```

For local frontend development, copy `frontend/.env.example` to `frontend/.env.local`, fill in the public deployment values, then run:

```bash
pnpm dev
```

## First deployment

**Start with [docs/SETUP_CHECKLIST.md](docs/SETUP_CHECKLIST.md)** — the step-by-step list for this campus. The summary below is the short version.

1. Build `apps-script/dist/Code.js` with `pnpm --filter @erfa/apps-script build`.
2. Create an Apps Script project, add the built `Code.js`, and use the built `appsscript.json` manifest.
3. Run `setupDatabase()` once from the Apps Script editor and authorize Sheets, Drive, external token verification, and email.
4. In the generated `SETTINGS` sheet, set `MS_TENANT_ID`, `MS_CLIENT_ID`, `MAIL_SENDER`, `ALLOWED_DOMAIN` and `FRONTEND_URL`. For this site `FRONTEND_URL` is `https://feubataan.github.io/feu-bataan-erfa`; notification emails use this configured base URL to link directly to each RFA.
5. Run `bootstrapAdmin('admin@uncbataan.edu.ph', 'Administrator Name')` once using the real initial administrator. This is intentionally not seeded.
6. Deploy the Apps Script project as a Web App executing as the owner and accessible to the users in scope.
7. Set the GitHub repository variables `VITE_API_URL`, `VITE_MS_CLIENT_ID` and `VITE_MS_TENANT_ID` (see [docs/SETUP_CHECKLIST.md](docs/SETUP_CHECKLIST.md)), then enable GitHub Pages through Actions.
8. Sign in as the bootstrapped administrator, add departments and users, then choose the officials under **Administration → Official Approval Settings**. No official is built in. The Approval Matrix is retained only for historical RFAs that already use the legacy routing model.

Full procedures are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The deployed system cannot authenticate or send mail until the administrator supplies Google configuration and grants authorization.

## Core workflow

`DRAFT -> SUBMITTED -> RECOMMENDING APPROVAL -> REVIEWED BY -> NOTED BY -> APPROVED BY -> APPROVED -> IMPLEMENTATION -> CLOSED`

For new RFAs, the requester selects active directory employees per RFA and the saved route is processed sequentially; all selected people in a stage must approve before the next stage is notified. Empty stages are skipped. Approvers can return an RFA for revision or disapprove it. Historical matrix-routed RFAs retain their legacy behavior.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [API](docs/API.md)
- [Workflow](docs/WORKFLOW.md)
- [Security](docs/SECURITY.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Setup checklist](docs/SETUP_CHECKLIST.md)
- [Admin guide](docs/ADMIN_GUIDE.md)
- [Maintenance](docs/MAINTENANCE.md)
- [Testing](docs/TESTING.md)
