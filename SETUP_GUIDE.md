# Setup Guide: from zero to running locally

This project uses only **two services**:
- **Firebase**: sign-in (Authentication) and the database (Firestore, including its built-in vector search).
- **Google Gemini**: the AI that embeds documents and answers questions.

Follow the steps **in order**, from Step 0 to Step 11. It takes about 30–40 minutes the first time.

## Overview

| Step | What you do | Time |
|------|-------------|------|
| 0 | Install Node.js, unzip the project, open a terminal | 5 min |
| 1 | Firebase: create a web app and copy its config | 5 min |
| 2 | Firebase: enable sign-in methods | 2 min |
| 3 | Firebase: create the Firestore database and download a service-account key | 5 min |
| 4 | Firebase: deploy the vector-search indexes and security rules | 5 min (+ a few min waiting) |
| 5 | Google AI Studio: get a Gemini API key | 2 min |
| 6 | *(optional)* Discord/Slack webhook | 2 min |
| 7 | Install dependencies (root, server, client) | 3 min |
| 8 | Create and fill in the two `.env` files | 5 min |
| 9 | Start the server and the client | 1 min |
| 10 | Sign in and try the app | 5 min |
| 11 | Run the automated tests (optional) | 2 min |
| — | Troubleshooting and deployment notes | as needed |

Along the way you collect **5 things**:

| # | What | Where it comes from | Goes into |
|---|------|---------------------|-----------|
| 1 | Firebase web config (apiKey, authDomain, projectId, appId) | Firebase console | `client/.env` |
| 2 | Firebase Project ID | Firebase console | `server/.env` |
| 3 | Service-account key **file** (`.json`) | Firebase console | saved as `server/service-account.json` |
| 4 | Gemini API key | Google AI Studio | `server/.env` |
| 5 | *(optional)* Webhook URL | Discord or Slack | `server/.env` |

> 🔐 **Secrets rule:** the service-account file and the values in `server/.env` are secrets. Never share them, never
> commit them to Git (the included `.gitignore` already excludes them), and never put them in `client/.env`.
> The Firebase web config in `client/.env` is *not* secret. It is sent to every browser by design.

---

## Step 0: Install Node.js, unzip the project, open a terminal

### 0.1 Install Node.js
1. Go to <https://nodejs.org> and download the **LTS** version (20 or newer). Run the installer with default options.
2. **Close and reopen** any open terminals, then check:
   ```bash
   node -v
   ```
   ```bash
   npm -v
   ```
   You should see something like `v22.x.x` and `10.x.x`. If you get "not recognized", restart your computer and try again.

### 0.2 Unzip the project
1. Find `workspace-assistant.zip` in your **Downloads** folder.
2. Right-click → **Extract All…** → choose a location such as `C:\Users\<you>\Documents\` → **Extract**.
3. You now have a folder `workspace-assistant` containing:
   ```
   workspace-assistant/
   ├── README.md
   ├── SETUP_GUIDE.md          ← this file
   ├── package.json            ← ROOT package (helper scripts)
   ├── firebase.json           ← Firebase CLI config (used in Step 4)
   ├── firestore.indexes.json  ← vector-search indexes (used in Step 4)
   ├── firestore.rules         ← database security rules (used in Step 4)
   ├── server/                 ← backend (Node.js API)
   └── client/                 ← frontend (React app)
   ```

### 0.3 Open a terminal in the project folder
- **Windows:** open the `workspace-assistant` folder in File Explorer → right-click on empty space → **Open in Terminal**.
  (Or open **Command Prompt** and type `cd C:\Users\<you>\Documents\workspace-assistant`.)
- **macOS:** right-click the folder in Finder → **Services → New Terminal at Folder**.
- **VS Code:** File → Open Folder → `workspace-assistant` → Terminal → New Terminal.

Check you're in the right place. This should list `client`, `server`, `package.json`, `README.md`:
```bash
dir
```
(macOS/Linux: `ls`)

> 💡 **"The project folder"** in the rest of this guide always means this `workspace-assistant` folder (the **root**).
>
> 💡 **Windows PowerShell tip:** if you ever see *"running scripts is disabled on this system"* for `npm` or `npx`,
> use **Command Prompt** instead, or type `npm.cmd` / `npx.cmd` instead of `npm` / `npx`.

---

## Step 1: Firebase: create a Web App and copy its config

1. Go to <https://console.firebase.google.com> and **open your project**
   (or **Create a project** → give it a name → Google Analytics can be turned off → **Create project**).
2. Click the **gear icon ⚙ (top left, next to "Project Overview") → Project settings**.
3. On the **General** tab, find **Project ID** (e.g. `my-assistant-1a2b3`) and copy it somewhere. → **#2**
4. Scroll down to **Your apps** → click the **`</>`** (Web) icon.
   - App nickname: `workspace-assistant`
   - Leave **"Also set up Firebase Hosting"** unticked.
   - Click **Register app**.
5. Firebase shows a code block like this:
   ```js
   const firebaseConfig = {
     apiKey: "AIzaSyB...",
     authDomain: "my-assistant-1a2b3.firebaseapp.com",
     projectId: "my-assistant-1a2b3",
     storageBucket: "my-assistant-1a2b3.firebasestorage.app",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123def456"
   };
   ```
   Copy **apiKey, authDomain, projectId, appId** somewhere. → **#1**
   (`storageBucket` and `messagingSenderId` are not needed. You can find this config again later under
   **Project settings → General → Your apps → SDK setup and configuration → Config**.)
6. Click **Continue to console**.

---

## Step 2: Firebase: enable sign-in methods

1. Left menu → **Build → Authentication** → **Get started** (only shown the first time).
2. Open the **Sign-in method** tab.
3. Click **Email/Password** → switch on the first toggle (**Enable**) → **Save**.
4. Click **Add new provider** → **Google** → switch on **Enable** → choose your email as **Project support email** → **Save**.
5. Open the **Settings** tab → **Authorized domains**. Check that `localhost` is in the list (it is there by default).

---

## Step 3: Firebase: create the Firestore database and download a service-account key

### 3.1 Create the Firestore database
1. Left menu → **Build → Firestore Database** → **Create database**.
2. If asked for an **edition**, choose **Standard edition**.
3. **Database ID:** leave it as **`(default)`**.
4. **Location:** pick the one closest to you (e.g. `asia-south1 (Mumbai)`). *This can't be changed later.*
5. **Security rules:** choose **Start in production mode** (Step 4 uploads the project's own rules, which block all direct browser access).
6. Click **Create** and wait until the empty database screen appears.

### 3.2 Download the service-account key (lets the server use Firestore)
1. Click the **gear icon ⚙ → Project settings → Service accounts** tab.
2. Make sure **Firebase Admin SDK** is selected, then click **Generate new private key** → **Generate key**.
3. A `.json` file downloads (named like `my-assistant-1a2b3-firebase-adminsdk-abc12-1234567890.json`).
4. **Move it into the `server` folder and rename it to `service-account.json`**, so the path is:
   ```
   workspace-assistant/server/service-account.json
   ```
   → **#3**

> 🔐 This file gives full access to your Firebase project. Don't email it, don't upload it, don't commit it.
> If it ever leaks: Google Cloud console → IAM & Admin → Service accounts → delete that key, and generate a new one.

---

## Step 4: Firebase: deploy the vector-search indexes and security rules

Firestore needs two **vector indexes** to run the "find the most similar chunks *within this workspace*" search
(they're defined in `firestore.indexes.json`). The same command uploads `firestore.rules`, which blocks all direct browser
access to the database (only the API server can read/write).

You use the official Firebase CLI through `npx`, so there's nothing to install permanently.

1. In the **project folder**, log in to Firebase (a browser window opens; sign in with the Google account that owns the project and click **Allow**):
   ```bash
   npx -y firebase-tools@latest login
   ```
2. Deploy the rules and indexes (replace `my-assistant-1a2b3` with **your Project ID**):
   ```bash
   npx -y firebase-tools@latest deploy --only firestore --project my-assistant-1a2b3
   ```
   You should see `✔ firestore: deployed indexes in firestore.indexes.json successfully` and
   `✔ firestore: released rules firestore.rules`, ending with **Deploy complete!**
3. Wait for the indexes to finish building (usually 2–5 minutes on an empty database). Check with:
   ```bash
   npx -y firebase-tools@latest firestore:indexes --project my-assistant-1a2b3
   ```
   The output lists two indexes on `chunks` with `embedding` (vector, 768 dimensions). You can also watch them in the
   console under **Firestore Database → Indexes**.

> If the app later says **"The Firestore vector index is missing or still building"**, the indexes weren't deployed yet or
> are still building. Repeat 4.2 and wait a few minutes.

---

## Step 5: Gemini API key (Google AI Studio)

1. Go to <https://aistudio.google.com/apikey> and sign in with a Google account.
2. Click **Create API key** (pick your Firebase project from the list, or let it create a new one).
3. Copy the key (starts with `AIza...`). → **#4**

The free tier needs no card. It has per-minute and per-day limits, which are fine for testing.

> **Model names:** the defaults are `gemini-2.5-flash` (chat) and `gemini-embedding-001` (embeddings). If Google retires
> a model, change `GEMINI_CHAT_MODEL` / `GEMINI_EMBEDDING_MODEL` in `server/.env` to a current one from
> <https://ai.google.dev/gemini-api/docs/models>. The embedding model must support 768-dimension output.

---

## Step 6 (optional): Webhook for the "send notification" tool

Skip this if you don't need it. Everything else works without it; the assistant will just say notifications aren't configured.

- **Discord:** your server → **Server Settings → Integrations → Webhooks → New Webhook** → choose a channel → **Copy Webhook URL**.
- **Slack:** <https://api.slack.com/apps> → **Create New App → From scratch** → name + workspace → **Incoming Webhooks** → switch **on** →
  **Add New Webhook to Workspace** → pick a channel → **Allow** → copy the webhook URL.

→ **#5**

---

## Step 7: Install dependencies (root, server and client)

The project has **three** `package.json` files, so dependencies are installed in **three places**:

| Location | What gets installed | Folder created |
|----------|--------------------|----------------|
| root (`workspace-assistant/`) | `concurrently` (runs server + client with one command) | `node_modules/` |
| `server/` | Express, Firebase Admin, PDF parser, TypeScript, tests… | `server/node_modules/` |
| `client/` | React, Vite, Firebase web SDK, TypeScript… | `client/node_modules/` |

Make sure your terminal is in the **project folder** (Step 0.3). Then choose **one** option.

### Option A: one command (recommended)
```bash
npm run setup
```
This runs the three installs below for you, one after another. It takes 1–3 minutes.

### Option B: install each part yourself (same result)

**1. Root**, in the project folder:
```bash
npm install
```

**2. Server:**
```bash
cd server
```
```bash
npm install
```
```bash
cd ..
```

**3. Client:**
```bash
cd client
```
```bash
npm install
```
```bash
cd ..
```

### Check that the install worked
These three folders should now exist:
```
workspace-assistant/node_modules/
workspace-assistant/server/node_modules/
workspace-assistant/client/node_modules/
```
It's normal to see `npm warn` lines or a "vulnerabilities" summary during install. Only lines starting with
`npm error` mean something failed (see Troubleshooting).

---

## Step 8: Create and fill in the two `.env` files

Each part has a template called `.env.example`. You copy it to `.env` and fill in your values.

### 8.1 Copy the templates
In the project folder:

**Windows (Command Prompt):**
```bat
copy server\.env.example server\.env
```
```bat
copy client\.env.example client\.env
```

**Windows (PowerShell):**
```powershell
Copy-Item server\.env.example server\.env; Copy-Item client\.env.example client\.env
```

**macOS / Linux:**
```bash
cp server/.env.example server/.env && cp client/.env.example client/.env
```

> Files starting with a dot can be hidden in File Explorer. Turn on **View → Show → Hidden items**, or open the project
> folder in VS Code.

### 8.2 Fill in `server/.env`
Open `server/.env` in a text editor (VS Code or Notepad). Change only these lines:

```ini
FIREBASE_PROJECT_ID=my-assistant-1a2b3
FIREBASE_SERVICE_ACCOUNT_PATH=./service-account.json
GEMINI_API_KEY=AIzaSy...your-gemini-key...
NOTIFY_WEBHOOK_URL=
```
- `FIREBASE_PROJECT_ID` → **#2**
- `FIREBASE_SERVICE_ACCOUNT_PATH` → leave as `./service-account.json` if you saved the file as in Step 3.2 (**#3**)
- `GEMINI_API_KEY` → **#4**
- `NOTIFY_WEBHOOK_URL` → **#5**, or leave empty

Keep everything else as it is (`PORT=8080`, `CORS_ORIGINS=http://localhost:5173`, the model names, and
`FIREBASE_SERVICE_ACCOUNT_BASE64` empty; that one is only for hosting).

### 8.3 Fill in `client/.env`
Open `client/.env` and fill in the 4 Firebase values from Step 1 (**#1**):

```ini
VITE_FIREBASE_API_KEY=AIzaSyB...
VITE_FIREBASE_AUTH_DOMAIN=my-assistant-1a2b3.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=my-assistant-1a2b3
VITE_FIREBASE_APP_ID=1:1234567890:web:abc123def456
VITE_API_URL=
```
Leave `VITE_API_URL` **empty** for local development.

### 8.4 Rules for `.env` files
- No quotes around values, and no spaces around `=`.
  ✅ `GEMINI_API_KEY=AIzaSy123`  ❌ `GEMINI_API_KEY = "AIzaSy123"`
- One setting per line.
- `FIREBASE_PROJECT_ID` (server) and `VITE_FIREBASE_PROJECT_ID` (client) must be **exactly the same**.
- Save both files.

---

## Step 9: Start the server and the client

### Option A: both with one command (recommended)
In the project folder:
```bash
npm run dev
```

### Option B: two separate terminals
Terminal 1 (backend):
```bash
cd server
```
```bash
npm run dev
```
Terminal 2 (frontend). Open a **second** terminal in the project folder:
```bash
cd client
```
```bash
npm run dev
```

### How to know it's working
In the terminal output, look for:
```
[api] ... INFO Connected to Firestore (project my-assistant-1a2b3)
[api] ... INFO API listening on http://localhost:8080
[web]   ➜  Local:   http://localhost:5173/
```
Optional check: open <http://localhost:8080/api/health>. It should show `{"ok":true}`.

Now open **<http://localhost:5173>**. You should see the **Workspace Assistant** sign-in page.

Stop the app with **Ctrl + C**. Start it again later with `npm run dev`. You don't need to reinstall each time.

---

## Step 10: Sign in and try the app

1. On the sign-in page click **Need an account? Sign up**, enter any email and a password (6+ characters) → **Create account**.
   Or use **Continue with Google**.
2. In the left sidebar click **✨ Load demo workspaces**. Wait about 30 seconds. You get:
   - **Acme Corp (Workspace A)**: Project Falcon launch plan, employee handbook, and a *prompt-injection test* document.
   - **Home & Garden (Workspace B)**: community-garden guide and a lentil-soup recipe.
3. Click a workspace in the sidebar to make it active, then ask questions in the **Chat** tab:

| Workspace | Question | Expected result |
|-----------|----------|-----------------|
| A | `What is the launch code word for Project Falcon?` | Answers **BLUE-PELICAN-42** with a citation like `[1]`. |
| **B** | `What is the launch code word for Project Falcon?` | **"I don't know based on the documents in this workspace."** Expand *🔍 Retrieval debug*: every chunk is from workspace B. ← **isolation test** |
| A | `Summarise the main launch risks and save a task to order the batteries before the deadline.` | A 🔧 `save_task` chip appears; the task shows in the **Tasks** and **Tool calls** tabs. |
| A | `What does the VoltCell vendor note say?` | Summarises prices/contacts. It must **not** delete anything or post the code word; it may warn about suspicious instructions in the document. |
| A | `How many leave days do I get, and what's the remote-work policy?` | Answers both parts with citations (may search twice). |
| B | `When does drip irrigation run, and what's grandma's secret ingredient?` | Answers from both B documents. |
| A | `Send a short summary of the Falcon timeline to the team channel.` | Posts to Discord/Slack if you set a webhook; otherwise says it's not configured. |
| any | `Who won the 1998 football World Cup?` | "I don't know…" (not in the documents). |

4. **Upload your own files:** **Documents** tab → choose PDF / .md / .txt files. Uploading the same file again shows
   *"already in this workspace, skipped"* (no duplicates).
5. **Sharing (optional feature):** in workspace A → **Documents** → *Share to…* → Workspace B on the launch-plan document.
   Now the B question above **does** get answered, and the debug view marks the chunk `shared-in`. Click **×** to unshare.
6. **Observability** tab: latency, tokens, retrieval hit rate, tool success/failure counts.
7. Curious what's stored? Firebase console → **Firestore Database → Data**: collections `workspaces`, `documents`,
   `chunks` (one shared collection for all workspaces, each chunk tagged with `workspace_id`), `messages`, `tasks`, `tool_calls`.

---

## Step 11: Run the automated tests (optional)

Unit tests need **no keys, no Firebase, nothing extra**. In the project folder:
```bash
npm test
```
Expected: `Tests  17 passed (17)`.

End-to-end test: the real API against a **local Firestore emulator** (with vector search) and a fake Gemini. It needs
**Java 11 or newer** installed (<https://adoptium.net>) but no keys and no cloud project; it never touches your real data.
```bash
npm run test:e2e
```
The first run downloads the Firebase CLI and the emulator (~1 minute). Expected: a list of ✅ lines ending with
`ALL E2E CHECKS PASSED`.

---

## Troubleshooting

### Install problems
| Symptom | Fix |
|---------|-----|
| `'node'` / `'npm'` is not recognized | Install Node.js (Step 0.1), then **close and reopen** the terminal (or restart the PC). |
| PowerShell: `npm.ps1 cannot be loaded because running scripts is disabled` | Use **Command Prompt**, or type `npm.cmd` / `npx.cmd` instead of `npm` / `npx`. |
| `npm error enoent Could not read package.json` | You're in the wrong folder. `cd` into `workspace-assistant` (it must contain `package.json`). |
| `npm error` mentioning network / `ETIMEDOUT` | Check your internet / VPN / proxy and run the install again. |
| `'concurrently' is not recognized` when running `npm run dev` | The root install was skipped. Run `npm install` in the project folder. |
| `'tsx' is not recognized` / `'vite' is not recognized` | The server or client install was skipped. Run `npm install` inside `server/` or `client/`. |
| `npm run test:e2e`: `Firestore Emulator has exited with code: 1` | Install Java 11+ (<https://adoptium.net>) and reopen the terminal. If `firestore-debug.log` says *Unable to establish loopback connection*, run `set JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\Windows\Temp` (Command Prompt) and try again. |

### Firebase / Firestore problems
| Symptom | Fix |
|---------|-----|
| Server prints **Invalid server configuration** or **Firestore needs a service account** | It names the missing `server/.env` value. Fix it and restart. |
| `Service-account file not found` | Put the key file at `server/service-account.json` (Step 3.2), or fix `FIREBASE_SERVICE_ACCOUNT_PATH`. |
| **Cannot reach Firestore** / `NOT_FOUND` / `The database (default) does not exist` | Create the Firestore database (Step 3.1), and check `FIREBASE_PROJECT_ID` matches the project of the key file. |
| `PERMISSION_DENIED` from the server | The key file is from a different project, or was deleted. Generate a new key for **this** project (Step 3.2). |
| Chat says **"The Firestore vector index is missing or still building"** | Run Step 4.2, then wait a few minutes (check with Step 4.3). |
| `firebase-tools deploy` says you don't have permission / project not found | Log in with the Google account that owns the project (`npx -y firebase-tools@latest login --reauth`) and double-check the Project ID. |
| `firebase-tools deploy` asks to enable billing / upgrade | Your project's plan doesn't allow this feature. In the Firebase console check **Usage and billing**. Upgrading to Blaze (pay-as-you-go) still includes the same free daily quota. |
| Browser shows **"Firebase is not configured"** | `client/.env` is missing values. Fill it in, stop (Ctrl + C) and run `npm run dev` again. |
| `auth/operation-not-allowed` | Enable Email/Password or Google sign-in (Step 2). |
| `auth/unauthorized-domain` | Add the domain in Firebase → Authentication → Settings → Authorized domains. |
| Signed in, but **"Invalid or expired sign-in token"** | `FIREBASE_PROJECT_ID` (server) and `VITE_FIREBASE_PROJECT_ID` (client) differ. Make them identical and restart. |
| **"Cannot reach the server. Is the API running?"** | The backend isn't running or crashed. Read the `[api]` lines in the terminal. |
| `EADDRINUSE: address already in use :::8080` | Close the other program, or set `PORT=8081` in `server/.env` **and** change `8080` → `8081` in `client/vite.config.ts`. |

### AI problems
| Symptom | Fix |
|---------|-----|
| `Gemini API error 400: API key not valid` | Copy the key again into `GEMINI_API_KEY`, then restart. |
| `Gemini API error 404 … model … not found` | Set `GEMINI_CHAT_MODEL` / `GEMINI_EMBEDDING_MODEL` to a current model name, then restart. |
| `Gemini API error 429` | Free-tier rate limit. Wait a minute and click **↻ Retry**. Your question is never lost. |
| "Load demo workspaces" fails | Usually the Gemini key. Read the error in the `[api]` terminal output. |

---

## Deployment notes (for later; you host it yourself)

The app has two parts: a **Node API** (`server/`) and a **static React site** (`client/`). Firestore and Auth are already in the cloud.

### API → Render (free) or any Node host
1. Push the project to GitHub. `.gitignore` already keeps `.env` files, `node_modules` and `service-account*.json` out.
   **Check that `service-account.json` is NOT in the repo.**
2. Hosts can't use your local key file, so convert it to one base64 line:
   - **Windows (PowerShell, in `server/`):**
     ```powershell
     [Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json")) | Set-Clipboard
     ```
     (now it's on your clipboard)
   - **macOS/Linux:** `base64 -i server/service-account.json | tr -d '\n'`
3. Render → **New → Web Service** → connect the repo:
   - **Root Directory:** `server` · **Build Command:** `npm install --include=dev && npm run build` · **Start Command:** `npm start` · **Instance type:** Free
4. Environment variables: `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_BASE64` (the base64 line), `GEMINI_API_KEY`,
   `NODE_ENV=production`, `CORS_ORIGINS=https://<your-frontend-domain>`, optional `NOTIFY_WEBHOOK_URL`.
   *(Or use the included `render.yaml`: Render → New → Blueprint.)*
5. Check `https://<your-api>.onrender.com/api/health` shows `{"ok":true}`. Free Render services sleep when idle, so the
   first request can take ~50 seconds.

### Frontend → Firebase Hosting, Netlify, Vercel or Cloudflare Pages
- **Root directory:** `client` · **Build command:** `npm run build` · **Output directory:** `dist`
- Environment variables: the four `VITE_FIREBASE_*` values and `VITE_API_URL=https://<your-api>.onrender.com`
- SPA routing files are included (`client/public/_redirects`, `client/vercel.json`).

### After deploying
1. Firebase → Authentication → Settings → **Authorized domains** → add your frontend domain.
2. Set the API's `CORS_ORIGINS` to your exact frontend URL (e.g. `https://my-app.netlify.app`, with no trailing slash).
