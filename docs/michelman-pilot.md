# Michelman Pilot Runbook

> First end-to-end production test of the AM workflow worker. Approving AM: `satya@ask-myra.ai`. Domain-first identity: `michelman.com`. Proof of success: a single account-level unified receipt.

## Why Michelman

Michelman is a real specialty chemicals + coatings company with public web presence, plausible Day AI / Freshsales / Apollo records, and a coherent myRA buyer hypothesis (Strategy / Innovation / Procurement decision-makers needing supplier intelligence and market intelligence). It is small enough to fit a 30-minute pilot run, and the receipt produced is directly reviewable by Satya.

## Prerequisites

1. **Worker is running** and reachable (`npm run worker:start` locally, or deployed URL).
2. **`.env.local` has worker credentials**:
   ```
   WORKER_BASE_URL=https://myra-worker.vercel.app
   WORKER_BEARER_TOKEN=<satya's token>
   ```
3. **Worker `.env` has provider + Day AI integration credentials** (see `worker/.env.example`):
   - `FRESHSALES_API_KEY`, `APOLLO_API_KEY`, `CLEAROUT_API_TOKEN`
   - `DAY_AI_CLIENT_ID` and either `DAY_AI_CLIENT_SECRET` (client_credentials) or a refresh token persisted by `worker:dayai-onboard`
   - `WORKER_BEARER_TOKENS` mapping `satya@ask-myra.ai:<token>`
4. **Day AI auth probed**: run `npm run worker:dayai-probe` to confirm grant types supported. Then `npm run worker:dayai-onboard` to authenticate the `harsha@ask-myra.ai` integration user.
5. **`npm run validate:all`** passes.

## The 11 Steps (mirrors the chat plan)

| # | Step | Worker call | Notes |
|---|---|---|---|
| 1 | Resolve identity using `michelman.com` | `worker:resolve-identity --account "Michelman" --domain michelman.com --owner-email satya@ask-myra.ai` | Expects `decision.action = auto_link_existing` (if Day AI has Michelman) or `allow_new_org_after_receipt` (if not). Green/Yellow/Red per confidence. |
| 2 | Freshsales duplicate / evidence lookup | `worker:freshsales-evidence --domain michelman.com` | Returns existing accounts, contacts, deals, conversations. Sets `providers.freshsales.duplicateRisk`. |
| 3 | Apollo persona search | `worker:apollo-search --domain michelman.com --persona-pack balanced --limit 25` | Returns ≤25 candidates already tiered Recommended/Maybe/Hold. |
| 4 | AM selects 2–3 contacts | _interactive_ | Codex walks bulk-with-veto: pre-approves Recommended by name, walks Maybe individually. Power escape: `select 1, 3, 7`. |
| 5 | Apollo enrichment (selected only) | `worker:apollo-enrich --candidate-ids "<ids>" --approving-am satya@ask-myra.ai` | Credit-consuming. Show cost before invoking. |
| 6 | Clearout verification (selected only) | `worker:clearout-verify --emails "<list>" --approving-am satya@ask-myra.ai` | Credit-consuming. Selected emails only. |
| 7 | Day AI duplicate check | `worker:dayai-write --action person-dedupe-check --canonical-domain michelman.com --candidates <path> --approving-am satya@ask-myra.ai` | Surfaces existing Day AI People + Freshsales overlap for each candidate. |
| 8 | Create / link Organization + Opportunity | `worker:dayai-write --action org-link\|org-create --canonical-domain michelman.com --approving-am satya@ask-myra.ai` then `--action opportunity-create --stage Researching` | Org write uses the idempotency key from step 1. Opportunity opens in `Researching`. |
| 9 | Create approved Day AI People | `worker:dayai-write --action person-create --canonical-domain michelman.com --candidate <payload> --approving-am satya@ask-myra.ai` (per contact) | Each write reuses the dedupe-check idempotency key. |
| 10 | Create cadence Actions + email Drafts | `worker:dayai-write --action action-create … --approving-am satya@ask-myra.ai` per step; for email steps also `--action draft-create` | Resolved cadence pack: `new-contact-standard`. Channel: `email-call`. AM walks each field for overrides. |
| 11 | Produce single account-level receipt | `worker:receipt --account michelman.com --am-package-dir /tmp/michelman-pilot --approving-am satya@ask-myra.ai` | Aggregates everything into `workflow/schemas/account-receipt.schema.json` shape. Writes local JSON + Day AI context page. |

## One-shot orchestration

```bash
# Dry-run first (no credits, no Day AI writes):
npm run michelman:pilot

# When the dry-run looks right, promote to production:
npm run michelman:pilot -- --promote
```

The orchestrator writes a per-step log to `<am-package-dir>/<am>/michelman.com/pilot-summary.json` and stops on the first failure (hard block — no auto-retry).

## Receipt acceptance criteria

The final receipt from step 11 must show:

- `summary.color = "green"` if everything cleared, else `yellow` (Maybe contacts or Freshsales duplicates) or `red` (any worker / Day AI failure).
- `providers.freshsales.status = "ok"` with a non-empty `evidenceCount`.
- `providers.apollo.candidateCount >= 1` with at least one Recommended.
- `providers.apollo.enrichmentStatus = "complete"` for any selected candidate IDs.
- `providers.clearout.verified + risky + invalid` equal to the count of emails Satya selected — never the full candidate slate.
- `providers.dayAi.savedObjects[]` contains at least one `organization`, one `opportunity`, ≥1 `person`, ≥1 `action`, ≥1 `draft`. Each has a real Day AI link / ID and the `idempotencyKey` Satya can re-quote on retry.
- `approvedBy = "satya@ask-myra.ai"` and `approvals[]` lists every write.
- `idempotencyKeys[]` non-empty.
- `persistence.localPath` exists on disk; `persistence.dayAiContextPageId` was returned.

**Idempotency proof**: running `npm run michelman:pilot -- --promote` a second time must not create duplicate Day AI records. The receipt will replay the same record IDs and the worker's `store.idempotency` map ensures `dayAiWrite` short-circuits to the prior result.

## Failure modes (expected and how to recover)

- **Worker unreachable**: Codex sets `runStatus=blocked` and shows a Red receipt with `headline: Worker call failed for <action>`. Restart the worker, then re-run from the failing step. No idempotency key was minted server-side; the next attempt is a fresh write.
- **Day AI write fails mid-pilot** (token expired, RPC error): the worker queues the attempted write into `pendingSync[]` and returns 502. Codex shows Red, offers `/retry now` (calls `worker:dayai-write --retry-idempotency-key <key>` — reuses the key, no duplicate created) or `/abandon`.
- **Apollo / Clearout credit exhaustion**: returned as `status: failed` with a credit-related `reason`. The receipt color is Red for that provider only.
- **Ambiguous identity**: `decision.action = block_org_creation_create_review_context`. The pilot **stops** at step 1; no Organization is created. Satya reviews the candidates manually and re-runs step 1 with `--parent-company` or explicit `--freshsales-account-ids` to disambiguate.

## Post-pilot

If receipt is Green: ramp to the next 5 P1 accounts on Satya's roster. You review the Day AI context page rendering and sign off on the worker for broader rollout.

If receipt has any Red blocker: file the failure in the project's blocker doc and re-run the affected step after the underlying fix lands. Do not bypass the worker.
