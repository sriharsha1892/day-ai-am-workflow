# GitHub Publishing

This repository is GitHub-ready. It currently needs a remote owner/name decision before it can be pushed.

Recommended repo:

```text
ask-myra/day-ai-am-workflow
```

Recommended visibility:

```text
private
```

After choosing the owner/name, publish with GitHub CLI:

```bash
git add .
git commit -m "Create Day AI AM workflow pack"
gh repo create ask-myra/day-ai-am-workflow --private --source=. --remote=origin --push
```

If the repo already exists:

```bash
git remote add origin git@github.com:ask-myra/day-ai-am-workflow.git
git push -u origin main
```

Do not publish secrets. This repo intentionally stores no Day AI OAuth tokens and no Freshsales API keys.

