# AI Command Center

Personal AI administration you run yourself and reach from your phone.

**Built and tested (against fake providers, fake exchanges and fake web services)**
- Secure login, encrypted API-key storage, AI Connections (xAI Grok, Gemini, OpenAI, any OpenAI-compatible API) with real connection tests and a same-provider fallback model.
- Chat with Think toggle, plus voice (microphone input and read-aloud, using the browser's speech features).
- AI Director: one instruction becomes up to 6 steps run by departments/agents, reviewed, corrected within limits, and combined. Assisted or Controlled mode, hard call limits, daily limit, retry limit, duplicate protection, cancel, recovery after restart.
- **Tools** (each shows its real status): web search (Brave Search API key), page reading (private/internal addresses blocked), workspace files (one flat folder), image generation (OpenAI-compatible providers, daily limit), and a manual-only JavaScript runner (off by default). Agents get only the tools you tick for them. Web pages and files are treated as untrusted data.
- 10 editable departments, agents, Memory (verified/unverified), JSON export and **restore (merge)**, audit log, **cost estimates** from the prices you enter, installable PWA.
- **Trading Intelligence (demo only):** Binance Spot Testnet and Deriv demo auto-trading. Strategies: Trend Rider, Breakout Hunter, Breakout-and-Retest, Mean Reversion, Momentum Explosion, Super Scalper; regime filter, Jitter Shield, A+ Setup score, smart re-entry, breakeven profit protection. Every signal is assessed by the AIs you choose; a deterministic risk engine makes the final call; AIs monitor open trades and can close them (Binance and Deriv); lessons go to Memory; backtest on past candles; kill switch.
- **Android app:** a GitHub Actions workflow builds an installable APK (section 4).

**Not built:** live trading (deliberately absent), a code sandbox that blocks the network (the JS runner limits time, memory and files but not network), running the server inside the APK, per-department model routing, scheduled jobs, push notifications.

**Important:** real Binance, Deriv, Brave and AI calls were NOT tested (no network or keys here), and the APK build was NOT run. Voice may not work inside the APK's WebView; it works in Chrome. Expect to fix small things on first contact, and start with the smallest stakes. This is not financial advice; most retail traders lose money.

## 1. Run on your Android phone (Termux)
```
pkg install nodejs git
git clone <your-repo-url> && cd ai-command-center
cp .env.example .env     # then edit: nano .env  (set APP_PASSWORD, SECRET_KEY)
npm start
```
Open `http://localhost:3000` in Chrome, sign in, then Chrome menu → **Add to Home screen**.
No npm install is needed (zero dependencies).

## 2. Configure the first provider
AI Connections → pick a provider → paste the API key → **Save and test**. The first test lists models; choose one and press **Save and test** again. Status becomes *Connected* only after a real request succeeds. Chat unlocks for connected providers only.
Keys: xAI https://console.x.ai · Gemini https://aistudio.google.com · OpenAI https://platform.openai.com. Check each provider's current free tier and limits yourself before relying on them.

## 3. Departments, agents, multi-agent tasks
- **Teams** tab: edit a department's instructions, switch it off, add an agent (name, role, instructions), or create a new department.
- **Tasks** tab: describe the job, pick a connected provider, choose Assisted or Controlled, set the hard call limit and correction rounds, press Create task. In Assisted mode review the plan and press Approve. Open a task to see each step, its agent, reviewer verdict, and the final result. Use Save result to Memory for keepers.
- A step with no agent uses its department's instructions as a default agent. Reviewer checks are done by the same model, so they are a safety net, not proof.

## 4. Build the Android app (GitHub Actions)
1. Create a GitHub repository and push this folder (`git init && git add . && git commit -m init && git remote add origin <url> && git push -u origin main`). Never commit `.env`.
2. GitHub → Actions → **Build Android APK** → Run workflow. When it finishes, download the `ai-command-center-apk` artifact, unzip, and install `app-debug.apk` (allow installs from your browser/file manager).
3. The app is a native Android shell around your server. Keep the server running (Termux: `termux-wake-lock` then `npm start`) and open the app; enter `http://localhost:3000`. It remembers the address.
Running the server inside the APK itself is not built.

### Hosting the server instead
Any host that runs a persistent Node 22 process works. Set `APP_PASSWORD` and `SECRET_KEY` as environment variables, start command `npm start`, persistent storage for `data/`, HTTPS only. Check the host's current free limits yourself.

## Continuing after a stop or restart
When the server starts it calls `resume()`, which continues where things stopped:
- **Tasks:** a task that was running goes back in the queue and carries on from the step it was on. Finished steps are not redone (up to 3 interruptions per task, then it waits for your Retry).
- **Trading bot:** if the bot was running and you did not press Stop or the kill switch, it restarts automatically after re-verifying the demo account and checking an AI is connected. Open positions are checked straight away. Turn this off in Trading settings (Continue automatically after a restart).
- **Orders mid-flight:** each Binance order carries an ID recorded before it is sent. After a crash the app looks the order up and adopts it if it filled, or clears it if it did not, so a trade is never lost or doubled. (Deriv orders do not have this protection.)
- **Stop, kill switch, or a failed broker check:** the bot stays stopped.
- This only works while the server process is running again. Stops and take-profits are still checked by the app, not placed on the exchange, so open Binance trades are unwatched while the server is down.

## Tools setup
- **Web search:** get a Brave Search API key from Brave's API site (check their current free allowance and terms), paste it in Tools → Save key.
- **Images:** Tools → pick an OpenAI-compatible provider, type the image model name from that provider's docs, set a daily limit. Each image costs money.
- **Agents with tools:** Teams → add an agent and tick the tools it may use. A task step then lets that agent search, read, or write files (up to 3 tool uses per attempt).
- **Prices:** Tools → Prices. Enter your provider's prices to see an estimate on the Dashboard.

## Trading setup
- **Binance:** create Spot Testnet keys at https://testnet.binance.vision (log in with GitHub). Trading tab → paste key and secret → Save and verify.
- **Deriv:** log in to your **demo** account, create an API token with Read and Trade scopes at https://app.deriv.com/account/api-token. Tokens from real accounts are refused and deleted.
- Select your connected AI(s), pick symbols (e.g. BTCUSDT, or R_100 for Deriv) and strategies, run a backtest, then Start. After a restart it continues by itself only if it was running, auto-resume is on, and the demo account re-verifies. Deriv needs Node 22+.
- Keys needed: 1 AI key minimum (2 recommended) + 1 broker demo credential.

## 5. Move to your laptop
`git clone`, copy `.env` and `data/` (backup), `npm start`. Same repo, same data format.

## 6. Backup and restore
Copy `data/db.json` (keys inside are encrypted) **and** keep your `SECRET_KEY` safe elsewhere. Without it, saved keys cannot be decrypted; just paste them again.

## 7. Keep credentials secure
- API keys go only into the AI Connections form; they are encrypted (AES-256-GCM) on the server and never returned to the browser.
- Never commit `.env`, `.secret` or `data/` (already in `.gitignore`). Never paste keys into chats, issues or screenshots.
- Use a long APP_PASSWORD. Login is throttled (5 failures / 15 min).
- Limits: this is a single-user app with a JSON file store; it is not hardened for multi-user or public production use.

## Tests
`npm test`: 38 automated tests against a fake provider (auth, invalid key, connect-only-after-success, key never exposed, fallback, rate limit, persistence, multi-agent handoff, review/correction, approval, budgets, retry, cancel, duplicates, recovery, memory, export, strategies, risk engine, Binance signed requests, Deriv demo-only check and early close, kill switch, AI monitor, web search/fetch with private-address blocking, files with path-escape refusal, images, tool permissions for agents, JS runner limits, cost estimate, import, UI screens with a stub DOM). Real provider calls and real-browser/phone rendering were **not** tested; they need your keys and your phone.

## Layout
`server.js` backend and provider adapters · `public/` PWA · `test/` · `.github/workflows/ci.yml`
