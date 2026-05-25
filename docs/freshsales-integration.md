# Freshsales Integration Boundary

Freshsales is read-only in v1. Use it to enrich Day AI account motions, not as the workflow ledger.

## Authentication

Every Freshsales request is server-side and uses:

```http
Authorization: Token token={FRESHSALES_API_KEY}
Content-Type: application/json
```

Base URL:

```text
https://{ORG_DOMAIN}.freshsales.io
```

Required env var:

```env
FRESHSALES_API_KEY=your_user_api_key
```

Optional rate-limit env vars:

```env
FRESHSALES_MINUTE_LIMIT=300
FRESHSALES_HOUR_LIMIT=4800
FRESHSALES_WAIT_POLL_MS=200
FRESHSALES_WAIT_TIMEOUT_MS=120000
FRESHSALES_WEBHOOK_TOKEN=your_shared_secret
```

## Endpoints Used

Contact and lead discovery:

- `/api/lookup?q={email}&f=email&entities=contact`
- `/api/search?q={email}&include=contact`
- `/api/lookup?q={email}&f=email&entities=lead`
- `/api/contacts/{id}?include=owner,sales_accounts`
- `/api/leads/{id}?include=owner,sales_accounts`

Account and deals:

- `/api/sales_accounts/{id}?include=owner`
- `/api/sales_accounts/{accountId}/deals?include=owner,won_reason,lost_reason`
- `/api/deals/{dealId}?include=owner`

Activities:

- `/api/contacts/{contactId}/activities`
- `/api/leads/{contactId}/activities`

Notes:

- `/api/{contacts|leads}/{id}/notes?per_page=50&sort=created_at&sort_type=desc`

Selectors:

- `/api/selector/deal_stages`
- `/api/selector/owners`
- `/api/selector/lifecycle_stages`
- `/api/settings/contacts/fields`

## Conversation Multi-Probe

Conversation endpoints are inconsistent. Try these in order and remember the last successful endpoint per entity type:

1. `/api/{contacts|leads}/{contactId}/conversations/all?include=email_conversation_recipients,targetable,user,body,html_content,display_content,snippet&per_page={perPage}`
2. `/{contacts|leads}/{contactId}/conversations/all?include=email_conversation_recipients,targetable,user,body,html_content,display_content,snippet&per_page={perPage}`
3. `/api/{contacts|leads}/{contactId}/conversations/all?include=email_conversation_recipients,targetable,user&per_page={perPage}`

If bulk rows lack body text, probe individual message body endpoints:

1. `/api/email_conversations/{conversationId}?include=body,html_content,display_content,email_conversation_recipients`
2. `/api/contacts/{contactId}/email_conversations/{conversationId}`
3. `/api/sales_emails/{conversationId}?include=body,html_content,display_content`

Circuit breakers:

- Per contact: skip remaining body probes if the first 2 body probes fail.
- Global: skip body probes if 6 body probe failures occur in the process.
- Hard cap: body-probe only the first 8 messages per contact.

## Email Filtering And Normalization

Keep only email-like rows:

- Keep when action type is email/reply/received/sent-like.
- Keep when sender, recipient, or subject fields exist.
- Drop calendar accept/decline/tentative/cancel events, calls, tasks, system events, and meeting-logistics-only rows.

Normalize to:

```ts
interface ConversationMessage {
  id: number | string;
  subject: string | null;
  direction: 'inbound' | 'outbound' | 'unknown';
  timestamp: string | null;
  from: string | null;
  to: string[];
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  source: string;
}
```

Infer direction from explicit fields, action type text, boolean flags, then activity-log subject matching.

Clean bodies by stripping reply chains, signatures, disclaimers, and excess whitespace. If cleanup removes too much content, keep the original.

## Rate Limits And Caching

Request pipeline:

```text
Sliding window limiter -> p-limit(3) -> adaptive pacing -> fetch()
```

Defaults:

- 300 requests/minute.
- 4800 requests/hour.
- Max 3 in-flight requests.
- Retry 5xx/network errors up to 2 times with jitter.
- On 429, respect `Retry-After`, pause all requests, and retry once.

Cache TTLs:

- Contact lookup: 30 minutes.
- Contact detail: 15 minutes.
- Account: 30 minutes.
- Deals by account: 15 minutes.
- Deal detail: 1 hour.
- Activities: 6 hours.
- Deal stages: 24 hours.
- Field definitions: 24 hours.
- Owners: 12 hours.
- Lifecycle stages: 24 hours.
- Conversations: never cache.
- Notes: never cache.

## Matching Rule

Do not trust account name alone. Match target accounts and contacts using an evidence bundle:

- Primary domain and known aliases.
- Email domains.
- Linked Freshsales sales accounts.
- Deals.
- Activities.
- Conversations.
- Notes.
- Parent/subsidiary clues.

Return candidate contacts with a confidence score and source trail. Only AM-selected contacts become canonical Day AI people.

