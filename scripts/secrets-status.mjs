#!/usr/bin/env node

import fs from 'node:fs';
import { envPath, loadLocalEnv, mask } from './env-utils.mjs';

const env = loadLocalEnv(envPath);
const required = [
  'FRESHSALES_API_KEY',
  'FRESHSALES_ORG_DOMAIN',
  'APOLLO_API_KEY',
  'CLEAROUT_BASE_URL',
  'CLEAROUT_API_TOKEN',
];

console.log('Local admin secret status');
console.log('-------------------------');
console.log(`File: ${envPath}`);
console.log(`Exists: ${fs.existsSync(envPath) ? 'yes' : 'no'}`);

if (fs.existsSync(envPath)) {
  const mode = (fs.statSync(envPath).mode & 0o777).toString(8).padStart(3, '0');
  console.log(`Permissions: ${mode}`);
  if (mode !== '600') {
    console.log('Warning: run `chmod 600 .env.local` to restrict access to the current user.');
  }
}

for (const key of required) {
  console.log(`${key}: ${mask(env[key])}`);
}
