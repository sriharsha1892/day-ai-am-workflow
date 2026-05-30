# myRA in Codex — Windows setup (≤ 5 minutes)

You'll get one secure link with one file. That's the whole setup.

## For you (the AM)

1. Open the secure link your admin sent (1Password Send) and download **`myra-setup-<you>.cmd`**.
2. **Double-click it.** A window runs for a few seconds and ends with **"Connected — you have N accounts."**
   - If it says *Codex isn't installed*: install it (`winget install OpenAI.Codex`), then double-click the file again.
3. Open **Codex** and type: **what are my accounts?** — you should see your list.

That's everything. You never touch a token or a config file, and the Windows **"couldn't set up admin sandbox"** error is handled for you automatically.

## For the admin

```bash
npm run issue-am-token -- --am <email> --installer
```

This issues the token (**live instantly — no redeploy**) and writes `.tokens/myra-setup-<am>.cmd`. Send that file via **1Password Send** (it embeds the token — never email/Slack). Re-run anytime to rotate; add `--revoke` to disable an AM.

If a corporate machine blocks self-install, the admin can run the same `.cmd` with the AM over a screenshare — identical result.

> The installer sets `[windows] sandbox = "unelevated"` and merges a `[mcp_servers.myra]` block into `~/.codex/config.toml` (backing up any existing config first), then verifies the token against the worker before the AM ever opens Codex.
