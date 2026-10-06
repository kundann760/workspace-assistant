# Deployment Guide: GitHub → Vercel

This guide takes the project that already works on your computer and:
1. **Part A** puts it on **GitHub** safely, so no `.env` files or keys are uploaded.
2. **Part B** deploys it to **Vercel** as **one project**. The React site and the API run on the same URL, e.g.
   `https://workspace-assistant.vercel.app` (site) and `https://workspace-assistant.vercel.app/api/...` (API).

Everything here is free (GitHub Free + Vercel Hobby, no card).

> ⚠️ Before you start: if you ever pasted your Gemini key anywhere public (chat, screenshot, email), create a new one in
> <https://aistudio.google.com/apikey>, delete the old one, and use the new one below.

---

## How secrets stay out of GitHub

The project's **`.gitignore`** file (in the project folder) tells Git which files to never upload. It already contains:

```gitignore
node_modules/
dist/
.env              ← server/.env and client/.env are never uploaded
.env.*
!.env.example     ← the templates (no real values) ARE uploaded, so others know what to fill in
service-account*.json        ← your Firebase private key is never uploaded
*-firebase-adminsdk-*.json
.vercel
```

On Vercel you type the same values into **Environment Variables** in the dashboard instead (Part B, Step 4). So:

| Where | Where the secrets live |
|-------|------------------------|
| Your computer | `server/.env`, `client/.env`, `server/service-account.json` |
| GitHub | **nowhere** (only the `.env.example` templates) |
| Vercel | Project → Settings → Environment Variables |

---

# Part A: Put the project on GitHub

## A1. Install Git (one time)
1. Download from <https://git-scm.com/download/win> and install with the default options.
2. **Close and reopen** your terminal, then check:
   ```bash
   git --version
   ```
3. Tell Git who you are (use your GitHub email):
   ```bash
   git config --global user.name "Kundan Mokhale"
   ```
   ```bash
   git config --global user.email "you@example.com"
   ```

## A2. Create an empty repository on GitHub
1. Go to <https://github.com/new> (sign in or create a free account).
2. **Repository name:** `workspace-assistant`
3. Visibility: **Private** (recommended; you can make it public later).
4. **Leave all of these UNticked / "None"**: *Add a README*, *Add .gitignore*, *Choose a license*.
   (The project already has them. Adding them here causes a conflict on the first push.)
5. Click **Create repository**. Keep the page open; it shows your repo URL, like
   `https://github.com/<your-username>/workspace-assistant.git`.

## A3. Make sure `.gitignore` is in place
In a terminal, inside the **project folder** (`workspace-assistant`, the one with `README.md`, `server`, `client`):

```bash
dir /a .gitignore
```
(PowerShell: `Get-ChildItem -Force .gitignore` · macOS/Linux: `ls -a .gitignore`)

You should see the file. Open it and check that it contains the lines shown in "How secrets stay out of GitHub" above.
If the `.vercel` line is missing, add it at the end.

## A4. Create the local repository and check nothing secret is included
```bash
git init
```
```bash
git add .
```
```bash
git status
```

**Read the list carefully.** It must **NOT** contain any of these:
- `server/.env` or `client/.env`
- `server/service-account.json`
- anything inside `node_modules/` or `dist/`

It **should** contain `server/.env.example` and `client/.env.example`.

Double-check with this command. Every file you list should be printed back with the `.gitignore` rule that ignores it:
```bash
git check-ignore -v server/.env client/.env server/service-account.json
```
Expected output (3 lines):
```
.gitignore:3:.env                       server/.env
.gitignore:3:.env                       client/.env
.gitignore:10:service-account*.json     server/service-account.json
```
If a file is **not** printed, it is NOT ignored. Stop, fix `.gitignore`, run `git rm -r --cached .` then `git add .` and check again.

## A5. Commit and push
```bash
git commit -m "Initial commit: multi-workspace document assistant"
```
```bash
git branch -M main
```
Replace `<your-username>` with your GitHub username:
```bash
git remote add origin https://github.com/<your-username>/workspace-assistant.git
```
```bash
git push -u origin main
```
The first push opens a browser window asking you to sign in to GitHub. Approve it, and the push completes.

> Warnings like `LF will be replaced by CRLF` are normal on Windows and harmless.

## A6. Verify on GitHub
Refresh the repository page. You should see `README.md`, `server/`, `client/`, `api/`, `vercel.json`, etc.
Click into `server/`: there must be **no** `.env` and **no** `service-account.json`.

> 🆘 **If a secret was pushed by mistake:** removing it in a new commit is not enough, because it stays in Git history.
> **Rotate it immediately**: create a new Gemini key and delete the old one; for the service account, Firebase →
> Project settings → Service accounts → generate a new key, then delete the old key in Google Cloud console → IAM →
> Service accounts → Keys. Then run `git rm --cached server/.env` (or the leaked file), commit and push.

### Later: pushing changes
Whenever you change code:
```bash
git add .
```
```bash
git commit -m "Describe what you changed"
```
```bash
git push
```
Vercel redeploys automatically after every push (Part B).

---

# Part B: Deploy to Vercel

### How it's set up (already done in the code)
- `vercel.json` (project root) tells Vercel how to install, build and route:
  - builds the API (`server/`) and the React site (`client/`)
  - serves the site from `client/dist`
  - sends every `/api/*` request to the serverless function `api/index.js`, which runs the Express API
- Because the site and the API share one domain, **no CORS setup or `VITE_API_URL` is needed**.

## B1. Prepare your service-account key as one line
Vercel can't read your local `service-account.json`, so you paste it as an environment variable, base64-encoded.

**Windows (PowerShell), inside the `server` folder:**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json")) | Set-Clipboard
```
The long encoded text is now on your clipboard. Paste it into Notepad for a moment; you'll need it in B4.

**macOS/Linux:**
```bash
base64 -i server/service-account.json | tr -d '\n'
```

## B2. Create a Vercel account
1. Go to <https://vercel.com/signup> → choose **Hobby** (free) → **Continue with GitHub**.
2. Allow Vercel to access your GitHub account. When asked which repositories, you can pick **Only select repositories** → `workspace-assistant`.

## B3. Import the project
1. Vercel dashboard → **Add New… → Project**.
2. Find `workspace-assistant` in the list → **Import**.
3. On the **Configure Project** screen:
   - **Framework Preset:** `Other`
   - **Root Directory:** leave as **`./`** (the repository root, where `vercel.json` is)
   - **Build and Output Settings:** **don't change anything.** `vercel.json` provides the install command, build command and output directory.

## B4. Add environment variables (before the first deploy)
Still on the Configure Project screen, open **Environment Variables** and add these one by one (Key → Value → **Add**):

**Server (secrets)**

| Key | Value |
|-----|-------|
| `FIREBASE_PROJECT_ID` | `workspace-18c8b` |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | the long base64 text from B1 |
| `GEMINI_API_KEY` | your Gemini key (same as in `server/.env`) |
| `GEMINI_CHAT_MODEL` | `gemini-3.8-flash` |
| `NODE_ENV` | `production` |
| `NOTIFY_WEBHOOK_URL` | *(optional)* your Slack/Discord webhook |

**Client (public Firebase web config)**: the same four values as in `client/.env`:

| Key | Value |
|-----|-------|
| `VITE_FIREBASE_API_KEY` | from `client/.env` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `workspace-18c8b.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `workspace-18c8b` |
| `VITE_FIREBASE_APP_ID` | from `client/.env` |

Rules:
- **Don't** add `FIREBASE_SERVICE_ACCOUNT_PATH` or `VITE_API_URL` on Vercel. Leave them out.
- No quotes around values.
- `VITE_*` values are baked into the site **at build time**. If you add or change one later, you must **Redeploy** (see Troubleshooting).

## B5. Deploy
Click **Deploy** and wait ~1–3 minutes. When it finishes you'll see your URL, e.g. `https://workspace-assistant-xxxx.vercel.app`.
Your stable production URL is shown under **Project → Settings → Domains** (usually `https://workspace-assistant.vercel.app`
or similar). Use that one below.

## B6. Allow the domain in Firebase
1. Firebase console → **Security → Authentication → Settings → Authorized domains → Add domain**.
2. Enter your Vercel domain **without** `https://`, e.g. `workspace-assistant.vercel.app` → **Add**.

Without this, sign-in fails with `auth/unauthorized-domain`.

## B7. Set CORS_ORIGINS and redeploy
1. Vercel → your project → **Settings → Environment Variables → Add**:
   `CORS_ORIGINS` = `https://workspace-assistant.vercel.app` (your exact domain, with `https://`, no trailing slash).
2. **Deployments** tab → **⋯** on the latest deployment → **Redeploy**.

## B8. Test the live app
1. Open `https://<your-domain>/api/health`. It should show `{"ok":true}`.
2. Open `https://<your-domain>`. You should see the sign-in page.
3. Sign in → **✨ Load demo workspaces** → ask *"What is the launch code word for Project Falcon?"* in Workspace A.
4. Ask the same question in Workspace B. It should say "I don't know…" (the isolation test).

🎉 Done. From now on every `git push` to `main` redeploys automatically.

---

## Vercel free-plan limits to know

| Limit | Effect in this app |
|-------|--------------------|
| **Request body ≤ 4.5 MB** | Upload files **smaller than ~4 MB** each, one at a time if they're big. Bigger uploads fail with HTTP 413. (Locally the limit is 10 MB.) |
| **Function max duration 300 s** (set in `vercel.json`) | Plenty for answers; very large PDFs may take a while to embed. |
| **Cold starts** | The first request after a quiet period can take a few seconds longer. |
| In-memory rate limit | Applies per server instance; fine for a demo. |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Build fails: `npm error` during install | Open the build log. Check that `server/package-lock.json` and `client/package-lock.json` are on GitHub. |
| Site loads but shows **"Firebase is not configured"** | `VITE_FIREBASE_*` variables were missing at build time. Add them → **Redeploy**. |
| `/api/health` returns **404** | `vercel.json` or `api/index.js` isn't in the repo root on GitHub. Push them, then redeploy. Root Directory must be `./`. |
| **500 / `FUNCTION_INVOCATION_FAILED`** | Vercel → project → **Logs**. Usually a missing/wrong env var; the log shows *Invalid server configuration* with the variable name. Fix it → Redeploy. |
| Log: `Firestore needs a service account` | `FIREBASE_SERVICE_ACCOUNT_BASE64` is missing, or was added after the deployment. Add it → Redeploy. |
| Log: `Unexpected token` / JSON error at startup | The base64 value is incomplete. Copy it again with the B1 command (it's one very long line). |
| Sign-in popup error `auth/unauthorized-domain` | Do B6 with the exact domain you're visiting. |
| Upload fails with **413** | The file is over Vercel's 4.5 MB request limit. Upload a smaller file. |
| Chat says *vector index is missing* | Firestore indexes weren't deployed. Run SETUP_GUIDE Step 4 (it's the same Firebase project used locally). |
| Changed an env var but nothing changed | Env vars apply to **new** deployments only. **Redeploy**. |
| Answers appear all at once instead of streaming | Harmless. Some networks/proxies buffer streams; the answer is still correct and saved. |
