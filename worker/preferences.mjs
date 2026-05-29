// Per-AM preferences — so an AM never re-specifies signature/tone/calendar/packs.
// KV key pref:{amEmail}. Read by compose.mjs to personalize drafts; set once via MCP.

import * as kv from './kv.mjs';

const key = (am) => `pref:${am}`;

const DEFAULTS = {
  signature: '',
  defaultTone: '',
  calendarLink: '',
  defaultPersonaPack: '',
  defaultCadencePack: '',
};

export async function getPreferences(amEmail) {
  const stored = (await kv.get(key(amEmail))) ?? {};
  return { ...DEFAULTS, ...stored, amEmail };
}

export async function setPreferences(amEmail, patch) {
  const current = await getPreferences(amEmail);
  const next = { ...current, ...clean(patch), amEmail, updatedAt: new Date().toISOString() };
  await kv.set(key(amEmail), next);
  return { ok: true, preferences: next };
}

function clean(patch) {
  const out = {};
  for (const k of ['signature', 'defaultTone', 'calendarLink', 'defaultPersonaPack', 'defaultCadencePack']) {
    if (patch[k] !== undefined) out[k] = patch[k];
  }
  return out;
}
