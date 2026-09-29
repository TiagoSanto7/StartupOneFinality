import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProvider, readLedger } from '../src/provider.js';
import { naiveRefund, requestRefund } from '../src/client.js';

const refund = { actionId: 'refund-order-001', amountCents: 80000 };
async function setup(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'finality-test-'));
  const ledgerPath = join(directory, 'refunds.jsonl');
  const provider = await startProvider({ ledgerPath, ...options });
  t.after(async () => {
    await provider.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { ...provider, ledgerPath };
}

test('commit precedes lost response and timeout; naive retry persists R$1,600', async t => {
  const events = [];
  const p = await setup(t, { onEvent: event => events.push(event.type) });
  await naiveRefund(p.url, refund, { timeoutMs: 500, onEvent: event => {
    events.push(event.type === 'attempt' ? `attempt_${event.attempt}` : event.type);
    if (event.type === 'timeout') {
      // Independent disk read at the timeout, before retry: first effect already exists.
      assert.equal(readLedger(p.ledgerPath).length, 1);
      assert.equal(readLedger(p.ledgerPath)[0].amountCents, 80000);
    }
  } });
  assert.deepEqual(events, ['attempt_1', 'committed', 'response_lost', 'timeout', 'attempt_2', 'committed']);
  const ledger = readLedger(p.ledgerPath);
  assert.equal(ledger.length, 2);
  assert.equal(ledger.reduce((sum, row) => sum + row.amountCents, 0), 160000);
  assert.ok(ledger.every(row => row.actionId === refund.actionId));
  assert.notEqual(ledger[0].refundId, ledger[1].refundId);
  await p.close();
  assert.equal(readLedger(p.ledgerPath).length, 2, 'effects survive provider shutdown');
});

test('lost response without retry still leaves R$800 committed', async t => {
  const p = await setup(t);
  await assert.rejects(requestRefund(p.url, refund, 500), { code: 'ETIMEDOUT' });
  assert.deepEqual(readLedger(p.ledgerPath).map(row => row.amountCents), [80000]);
});

test('without injected loss, naive client sends only one refund', async t => {
  const p = await setup(t, { loseFirstResponse: false });
  await naiveRefund(p.url, refund);
  assert.deepEqual(readLedger(p.ledgerPath).map(row => row.amountCents), [80000]);
});

test('invalid input is not committed or retried', async t => {
  const events = [];
  const p = await setup(t);
  await assert.rejects(naiveRefund(p.url, { ...refund, amountCents: -1 }, {
    onEvent: event => events.push(event.type),
  }), /HTTP 400/);
  assert.deepEqual(events, ['attempt']);
  assert.deepEqual(readLedger(p.ledgerPath), []);
});
