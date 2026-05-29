// Identity Provider interface + registry. The OAuth broker depends ONLY on this
// interface, never on a concrete provider — so Day AI, Google Workspace, Microsoft,
// or email-magic-link are interchangeable by registering a different implementation.
//
// An IdentityProvider implements:
//   name: string
//   startAuthorization({ state, callbackUrl }) -> Promise<{ redirectUrl }>
//       Where to send the AM's browser to authenticate. `state` round-trips back to us.
//   handleCallback({ query, callbackUrl }) -> Promise<{ amEmail, downstream }>
//       Resolve the AM's verified identity (and any downstream tokens to reuse) from the
//       provider's redirect. `downstream` is opaque to the broker; the worker uses it
//       (e.g. the AM's Day AI refresh token for attributed writes).

import { dayAiIdP } from './idp-dayai.mjs';

const REGISTRY = new Map();

export function registerIdP(provider) {
  REGISTRY.set(provider.name, provider);
}

export function getIdP(name) {
  const key = name ?? process.env.AUTH_IDP ?? 'dayai';
  const provider = REGISTRY.get(key);
  if (!provider) throw new Error(`No identity provider registered for "${key}"`);
  return provider;
}

// Register the built-ins. To add Google/MS/magic-link: implement the interface in a new
// file and registerIdP(...) it here. No broker changes required.
registerIdP(dayAiIdP);
