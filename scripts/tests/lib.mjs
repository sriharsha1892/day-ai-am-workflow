// Shared test helpers. Tests assert against unit-testable pieces of the worker
// (identity scoring, store idempotency, end-tour roll-up) without requiring a deployed worker.

import assert from 'node:assert/strict';

export function test(name, fn) {
  const start = Date.now();
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  OK  ${name} (${Date.now() - start}ms)`);
      return { name, ok: true };
    })
    .catch((error) => {
      console.error(`  FAIL ${name}`);
      console.error(`    ${error.message}`);
      if (error.stack) console.error(error.stack.split('\n').slice(1, 4).join('\n'));
      return { name, ok: false, error: error.message };
    });
}

export { assert };
