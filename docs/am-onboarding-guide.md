# myRA Workflow — AM Onboarding Guide

*For Satish, Sudeshana, Kirandeep, Nikita, and Vijay*

## What this is

Codex is your workspace for working accounts. It pulls contacts, verifies emails, drafts non-salesy first touches, and saves the good stuff to Day AI — and **you approve everything**. Nothing sends on its own.

You talk to it in plain English. No commands to memorize.

---

## One-time setup (do this once)

You'll connect Codex to the myRA server. Sign in with **your own Day AI account** — there's no token to copy or paste.

**On Mac or Windows, run these two lines in your terminal:**

```
codex mcp add myra --url https://myra-am-worker.vercel.app/mcp
```

Then sign in:

```
codex mcp login myra
```

A browser window opens — log in with your Day AI account and approve. That's it.

> Tip: if a flag doesn't look right, run `codex mcp add --help` to see the exact options for your version.

**Can't use login?** (rare) Ask the admin for a personal token, then add the server with your token instead — the admin will give you the exact line, which looks like `... --bearer-token-env-var MYRA_TOKEN` after you've set `MYRA_TOKEN` to the token they send you. Most people should just use login above.

---

## Daily use — just talk to it

Type these in plain language. Examples:

- **"What are my accounts?"** → your assigned list
- **"Research [Account], walk me through it"** → a guided briefing
- **"Find contacts at [Account]"** or **"Who should I target?"** → people grouped as Recommended / Maybe / Hold
- **"Work this contact"** → finds + verifies their email, prepares a LinkedIn note, and writes a non-salesy first-touch draft for your review
- **"Build a cadence"** → a simple follow-up sequence
- **"What's saved?"** → what's been logged to Day AI so far
- **"Continue"** → pick up where you left off
- **"Bye"** → wraps up and summarizes

---

## What to expect

- **Colored receipts** after each step:
  - 🟢 **Green** — safe / saved, keep going
  - 🟡 **Yellow** — one quick decision needed from you
  - 🔴 **Red** — stop and review; nothing gets created or sent
- **You approve before anything saves to Day AI.** Codex shows what it found and what it wants to do — you say yes.
- **LinkedIn requests you send yourself.** Codex writes the note; you copy it, open the profile, and click Connect. Codex never auto-connects.

---

## The guardrails (in plain words)

- **Nothing goes out without you** — no emails, no LinkedIn requests, no Day AI saves until you approve.
- **Freshsales is read-only** — Codex looks but never changes anything there.
- **Credits are shown before they're spent** — email verification and enrichment cost credits, and you'll always see it coming first.

---

## Your first run (about 5 minutes)

1. **Connect** — run the two setup lines above (one time).
2. Type **"What are my accounts?"** — confirm your list looks right.
3. Pick one account and type **"Work my top contact at [that account]."**
4. **Review** what Codex found — the email, the LinkedIn note, the draft.
5. **Approve** the save to Day AI.

That's a full loop. Do it once and the rest is the same pattern.

---

## If something breaks

- **Re-run** `codex mcp login myra` — fixes most sign-in hiccups.
- **Ask in the team channel** — someone's likely hit the same thing.
- **Admin:** harsha@ask-myra.ai
