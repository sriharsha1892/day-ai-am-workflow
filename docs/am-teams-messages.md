# Per-AM MS Teams messages (manual setup — no installer)

How to send each one:
1. Open a **1:1 Teams chat** with the AM (never a group/channel — the snippet holds their personal key).
2. Share their config snippet from `.tokens/` (paste its contents, or attach the file):
   - Kirandeep → `myra-config-kirandeep.toml`
   - Sudeshana → `myra-config-sudeshana.toml`
   - Nikita → `myra-config-nikita.toml`
   - Vijay → `myra-config-vijay.toml`
   - Satish → `myra-config-satish.toml`
3. Paste the message below (same for everyone — just change the name).

> Prefer 1Password Send for the snippet (it contains their access key). Generate/rotate any AM's
> snippet with: `npm run issue-am-token -- --am <email> --config`.

---

## Message template (replace **[Name]**)

Hi [Name],

Setting you up on **myRA in Codex** — you'll use it to pull your accounts, find and verify contact
emails, see who we're already talking to, and draft outreach for your review. It never sends anything
without your approval.

Setup is a quick copy-paste (no download to run):

1. I'm sending you a short **config snippet** (separately/securely).
2. Open your Codex settings file — on **Windows**: press `Win+R`, paste `%USERPROFILE%\.codex` , Enter,
   then open (or create) **`config.toml`** there with Notepad. (Mac: `~/.codex/config.toml`.)
3. **Paste the snippet** into that file and save. If the file already had text, just add it at the end.
4. **Restart Codex** and type: **what are my accounts?** — you should see your list.

Keep the snippet to yourself — it includes your personal key. Stuck anywhere? Message me — I can do it
with you on a quick screenshare.

---

## Cover line to send with the snippet

> Hi [Name] — here's your myRA config snippet (secure). Paste it into your Codex `config.toml`, save,
> restart Codex, then type *what are my accounts?* Full steps are in the note I sent.
