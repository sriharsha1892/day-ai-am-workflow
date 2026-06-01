# myRA — manual setup (no installer)

Use this when the one-click `.cmd` is blocked by antivirus/firewall. It runs **no program** — you
just paste two small blocks into a settings file. ~3 minutes.

## What you need
- **Codex** installed.
- The **config snippet** your admin sends you (a few lines that include your personal access key).

## Steps (for the AM)
1. Open your Codex config file. Create it if it doesn't exist:
   - **Windows:** press `Win+R`, paste `%USERPROFILE%\.codex` , Enter → open (or create) **`config.toml`** in that folder with Notepad.
   - **Mac:** open `~/.codex/config.toml`.
2. **Paste the blocks your admin sent** into that file.
   - If the file already had content, just add these at the end (keep what was there).
   - If you see an old `[mcp_servers.day-ai]` block, **delete it** — myRA now goes through the `myra` server.
3. **Save** the file.
4. **Restart Codex** (fully close and reopen).
5. In Codex, type: **what are my accounts?** — you should see your list.

That's it. The snippet contains the Windows sandbox fix and your myRA connection.

**Keep the snippet to yourself** — it includes your personal access key. If you get stuck, your admin
can do steps 1–4 with you on a quick screenshare.

---

## For the admin
Generate a per-AM snippet (no `.cmd`, embeds the token):

```bash
node scripts/make-am-installer.mjs --am kirandeep@ask-myra.ai --manual
# → .tokens/myra-config-<name>.toml   (SECRET — share via 1Password Send)
```

The snippet is exactly:

```toml
[windows]
sandbox = "unelevated"

[mcp_servers.myra]
url = "https://myra-am-worker.vercel.app/mcp"
http_headers = { Authorization = "Bearer <that AM's token>" }
```

Share the `.toml` (or just paste its contents) over a secure channel. Rotate anytime with
`npm run issue-am-token -- --am <email>` (then re-run with `--manual`).

> Manual setup runs no executable, so it sidesteps AV/SmartScreen blocking the `.cmd`. **Note:** the
> machine's firewall must still allow Codex to reach `myra-am-worker.vercel.app` over HTTPS — if the
> firewall blocks that host itself (not just the `.cmd`), the connection needs the domain allow-listed
> regardless of setup method.
