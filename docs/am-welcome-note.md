# Welcome note for AMs (manual setup — paste into Slack/email)

> Replace **[Name]** with the AM's first name. Send the config snippet separately/securely (1Password
> Send) — never paste the snippet itself into a group chat; it contains their personal key.

---

Hi [Name],

We're connecting you to **myRA inside Codex** — the assistant you'll use to pull your assigned
accounts, find and verify contact emails, check who we're already talking to, and draft a first
outreach for your review. It never sends anything on its own; you approve every step.

Setup is a quick copy-paste (~2 minutes) — nothing to download or run.

**What you need first:** the **Codex** app installed. If you don't have it, install it
(`winget install OpenAI.Codex`), then continue.

**Steps:**
1. I'll send you a short **config snippet** (a few lines, securely).
2. Open your Codex settings file:
   - **Windows:** press `Win+R`, paste `%USERPROFILE%\.codex` , Enter → open (or create) **`config.toml`** with Notepad.
   - **Mac:** open `~/.codex/config.toml`.
3. **Paste the snippet** in and save. If the file already had content, just add it at the end (keep what was there).
4. **Restart Codex** (fully close and reopen) and type: **what are my accounts?** — your list should appear.

Two notes:
- Keep the snippet to yourself — it includes your personal access key.
- If you see an old `[mcp_servers.day-ai]` block in that file, delete it — myRA goes through the `myra` server in the snippet.

If you get stuck at any step, message me — I can also do it with you over a quick screenshare.

— Harsha

---

## Cover line to send with the snippet

> Hi [Name] — here's your myRA config snippet (secure). Paste it into your Codex `config.toml`, save,
> restart Codex, then type *what are my accounts?* Full steps are in the note I sent.
