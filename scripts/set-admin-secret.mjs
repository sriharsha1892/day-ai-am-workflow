#!/usr/bin/env node

import { envPath, loadLocalEnv, promptSecret, writeLocalEnv } from './env-utils.mjs';

const allowedKeys = new Set([
  'FRESHSALES_API_KEY',
  'FRESHSALES_ORG_DOMAIN',
  'APOLLO_API_KEY',
  'CLEAROUT_API_TOKEN',
]);

const key = process.argv[2];
if (!allowedKeys.has(key)) {
  console.error(`Usage: node scripts/set-admin-secret.mjs <${[...allowedKeys].join('|')}>`);
  process.exit(2);
}

const env = loadLocalEnv(envPath);
const value = await promptSecret(`Enter value for ${key} (input hidden): `);
if (!value) {
  console.error(`${key} was not updated because no value was provided.`);
  process.exit(1);
}

env[key] = value;
if (!env.FRESHSALES_ORG_DOMAIN) env.FRESHSALES_ORG_DOMAIN = 'mordorintelligence';

writeLocalEnv(env, envPath);
console.log(`${key} updated in ${envPath}. Value not printed.`);
