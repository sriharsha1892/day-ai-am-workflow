import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export const envPath = '.env.local';

export function loadLocalEnv(filePath = envPath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return {};

  const env = {};
  const text = fs.readFileSync(absolutePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
  return env;
}

export function applyEnv(env) {
  for (const [key, value] of Object.entries(env)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

export function writeLocalEnv(env, filePath = envPath) {
  const orderedKeys = [
    'FRESHSALES_API_KEY',
    'FRESHSALES_ORG_DOMAIN',
    'APOLLO_API_KEY',
    'CLEAROUT_BASE_URL',
    'CLEAROUT_API_TOKEN',
  ];
  const keys = [
    ...orderedKeys.filter((key) => Object.prototype.hasOwnProperty.call(env, key)),
    ...Object.keys(env).filter((key) => !orderedKeys.includes(key)).sort(),
  ];
  const text = `${keys.map((key) => `${key}=${env[key] ?? ''}`).join('\n')}\n`;
  fs.writeFileSync(filePath, text, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

export function mask(value) {
  if (!value) return 'missing';
  if (value.length <= 6) return 'set';
  return `set (${value.slice(0, 3)}...${value.slice(-3)})`;
}

export async function promptSecret(question) {
  const rl = readline.createInterface({ input, output });
  const previousRawMode = input.isRaw;
  if (input.isTTY) input.setRawMode(true);

  return new Promise((resolve) => {
    let value = '';
    output.write(question);

    const onData = (char) => {
      const text = char.toString('utf8');
      if (text === '\u0003') {
        cleanup();
        output.write('\n');
        process.exit(130);
      }
      if (text === '\r' || text === '\n') {
        cleanup();
        output.write('\n');
        resolve(value.trim());
        return;
      }
      if (text === '\u007f') {
        value = value.slice(0, -1);
        return;
      }
      value += text;
    };

    function cleanup() {
      input.off('data', onData);
      if (input.isTTY) input.setRawMode(previousRawMode ?? false);
      rl.close();
    }

    input.on('data', onData);
  });
}
