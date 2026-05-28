# Satya Onboarding — myRA AM Workflow

> One-page setup. Everything below has been provisioned for you; you just need to wire it on your laptop.

## What you've been given

| Item | Value |
|------|-------|
| Worker URL | `https://myra-am-worker.vercel.app` |
| Your bearer token | (will be sent securely — see Section "Receive your token") |
| Your AM email | `satya@ask-myra.ai` |
| Day AI integration user | `harsha@ask-myra.ai` (system-managed; you don't authenticate as this) |
| First test account | Michelman (`michelman.com`) |

You do **not** need: Freshsales, Apollo, or Clearout API keys. They live only on the worker.

## One-time setup (5 minutes)

1. **Pull the repo** to your laptop (same repo Codex points at):
   ```bash
   git clone <repo-url> ~/Documents/myra-am-workflow
   cd ~/Documents/myra-am-workflow
   npm install
   ```

2. **Create `.env.local` at the repo root** (mode 0600). Paste:
   ```
   WORKER_BASE_URL=https://myra-am-worker.vercel.app
   WORKER_BEARER_TOKEN=<your token from Receive your token below>
   AM_EMAIL=satya@ask-myra.ai
   AM_PACKAGE_DIR=am-package
   ```
   Then `chmod 600 .env.local`.

3. **Set up Codex MCP for Day AI** (so Codex can read Day AI directly during dry-run):
   ```bash
   npm run setup:codex
   ```
   Browser opens for Day AI OAuth — sign in with `satya@ask-myra.ai`. This is per-user OAuth for dry-run reads only; production writes route through the worker.

4. **Open Codex from this folder.** Codex auto-loads `AGENTS.md`. First message: literally just say `continue` or `start my tour` — Codex calls `worker:run-state next-resume` and greets you.

## Receive your token

Sriharsha will send your worker bearer token via the team password manager / 1Password vault under `myra-am-worker / satya@ask-myra.ai`. Do **not** paste it in Slack, email, or git.

If you rotate it later, ping Sriharsha — he updates `WORKER_BEARER_TOKENS` in Vercel project settings and re-deploys.

## Verify it works (60 seconds)

```bash
# Should print: {"ok":true,"providers":{...freshsales ok, apollo ok, clearout ok...}}
curl -s https://myra-am-worker.vercel.app/health | head -c 300

# Should print a Green receipt with Apollo + Freshsales evidence for Michelman.
npm run worker:resolve-identity -- --account "Michelman" --domain michelman.com --owner-email satya@ask-myra.ai
```

If both work, you're ready.

## How a tour actually flows

You never type slash commands. Just talk to Codex.

| You say | Codex does |
|---------|-----------|
| `continue` / `start my tour` | Auto-resumes the highest-priority unfinished account (or shows your queue if first day). |
| `who should I target at Michelman?` | Runs `/map-contacts` (calls Apollo + Freshsales via worker). Shows ≤25 candidates already tiered Recommended/Maybe/Hold. Pre-approves Recommended as a batch by name; you can veto by name or type `select 1, 3, 7` to override. |
| `draft outreach for Steven` | Runs `/draft-outreach`. Walks tone/CTA/length with you. Shows draft. Writes to Day AI on your approval (worker stamps your email as `approvedBy`). |
| `make a cadence` | Runs `/build-cadence`. Walks each step (channel? timing? tone? CTA?) — say `keep` to accept defaults. |
| `what's saved?` | Runs `/account-health` → produces the **single account-level receipt** (Green/Yellow/Red headline + narrative + provider bullets + next action). Receipt is saved both as JSON in `am-package/satya@ask-myra.ai/<domain>/receipts/<ts>.json` and as a Day AI context page on the Organization. |
| `bye` / `wrap up` / `done for today` | Codex runs the end-of-tour roll-up: `"Today: 5 accounts, 12 contacts, 5 drafts. 2 blockers. Resume tomorrow with TDK?"` Writes a digest to `am-package/satya@ask-myra.ai/digests/<date>.md`. |
| `mcp crashed` / `retry sync` | Codex inspects `pendingSync[]` and retries with the same idempotency key (the worker enforces no-duplicate-creation). |
| `show details` / `why` | Expands the last receipt's `expanded` payload + trust panel. |

Codex always asks before writing to Day AI. If you say no, nothing is written. If the worker is unreachable, you see a Red receipt — no retries happen behind your back, you choose `/retry now` or `/abandon`.

## Known limitation today

**Day AI writes will Red until OAuth onboarding completes.** Sriharsha needs to:
1. Register an OAuth client for `harsha@ask-myra.ai` as a Day AI integration app, then
2. Run `npm run worker:dayai-probe` (confirms grant types Day AI supports), then
3. Run `npm run worker:dayai-onboard` (one-time browser flow), then
4. Push the resulting refresh token to Vercel as `DAY_AI_REFRESH_JSON` env var.

Until that's done, everything **except** Day AI writes works: identity resolution (using Day AI for read-evidence only is no-op gracefully), Freshsales evidence pulls, Apollo searches/enrichment, Clearout verification, receipt rendering, tour state tracking, end-of-tour roll-up.

When the AM tour reaches a Day AI write step, the worker returns Red with a clear `pending_sync` queue entry. Codex shows it; you can dry-run-complete the account or wait for the Day AI piece to land.

## Pilot account: Michelman

Sriharsha has prepared `templates/michelman-pilot.json` as your first pilot account. Already proven on the worker:

- Identity resolution → `auto_link_existing` (Green) with 0.99 confidence — Apollo + Freshsales both found Michelman.
- Freshsales evidence → 2+ existing contacts (Steven Reekmans, Paul Griffith) with last-activity timestamps.

To run the orchestrated 11-step pilot end-to-end (steps 7–10 will Red until Day AI auth completes — that's expected):

```bash
# Dry-run (free, no credit spend):
npm run michelman:pilot

# Once Day AI is wired:
npm run michelman:pilot -- --promote
```

The single account-level receipt at step 11 lands in `am-package/satya@ask-myra.ai/michelman.com/receipts/<ts>.json`.

## Quick reference

- **Worker:** https://myra-am-worker.vercel.app — public-by-design; bearer auth is the gate.
- **Project repo:** this repo.
- **AGENTS.md:** Codex's system prompt (defines all behavior).
- **`workflow/shortcuts/*.md`:** the contracts Codex follows per command.
- **`workflow/config/*.json`:** packs, UX, identity rules.
- **`scripts/worker-*.mjs`:** what Codex actually invokes for production work (you never call these directly).
- **`docs/michelman-pilot.md`:** the 11-step pilot runbook.

## If something feels off

- **Codex doesn't seem to know about the worker:** check `AGENTS.md` first-line declaration and that `npm run validate:all` passes.
- **`Worker not configured`:** your `.env.local` is missing `WORKER_BASE_URL` or `WORKER_BEARER_TOKEN`.
- **`401 Unauthorized`:** token typo, or Sriharsha rotated tokens — ping him.
- **`Red — Worker unreachable`:** the worker may have cold-started; retry once. If repeating, check https://myra-am-worker.vercel.app/health.
- **`Red — Day AI pending_sync`:** expected until Day AI integration user onboarding completes.

For anything else, the trust panel + receipt narrative tell you what the worker did and didn't do. Read those first.
