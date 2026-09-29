import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentCommit } from '../src/agent-commit.js';
import { startProvider, readLedger } from '../src/provider.js';
import { readbackRefunds } from '../src/client.js';

const input = { actionId: 'refund / order?001&test', amountCents: 80000 };
async function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'reconcile-test-'));
  const ledgerPath = join(directory, 'refunds.jsonl');
  const provider = await startProvider({ ledgerPath });
  const options = { directory: join(directory, 'effects'), providerUrl: provider.url, timeoutMs: 500 };
  const gate = new AgentCommit(options);
  t.after(async () => { await provider.close(); rmSync(directory, { recursive: true, force: true }); });
  await assert.rejects(gate.execute(input), { code: 'OUTCOME_UNKNOWN' });
  return { gate, ledgerPath, provider, options };
}

test('readback resolves UNKNOWN, preserves identity and grants MAY_ADVANCE without another refund', async t => {
  const { gate, ledgerPath, provider, options } = await setup(t);
  const before = gate.get(input.actionId);
  assert.deepEqual((await readbackRefunds(provider.url, input.actionId)).refunds, readLedger(ledgerPath));
  assert.deepEqual(await readbackRefunds(provider.url, 'another-action'), { refunds: [] });
  const pending = gate.reconcile(input.actionId);
  assert.equal(gate.get(input.actionId).state, 'RECONCILING');
  await assert.rejects(gate.execute(input), { code: 'RETRY_BLOCKED' });
  assert.throws(() => gate.assertMayAdvance(input.actionId), { code: 'CONTINUATION_BLOCKED' });
  await assert.rejects(gate.reconcile(input.actionId), { code: 'RECONCILIATION_BLOCKED' });
  const resolved = await pending;
  assert.equal(resolved.effect_id, before.effect_id);
  assert.equal(resolved.attempts.length, 1);
  assert.deepEqual(resolved.history.map(event => event.state),
    ['PREPARED', 'DISPATCHED', 'UNKNOWN', 'RECONCILING', 'COMMITTED']);
  const reloaded = new AgentCommit(options);
  assert.equal(reloaded.assertMayAdvance(input.actionId).decision, 'MAY_ADVANCE');
  assert.equal((await reloaded.execute(input)).receipt.refundId, resolved.receipt.refundId);
  assert.equal((await reloaded.reconcile(input.actionId)).reconciliations.length, 1);
  assert.deepEqual(readLedger(ledgerPath).map(row => row.amountCents), [80000]);
});

for (const scenario of ['absent', 'duplicate', 'wrong amount', 'invalid receipt']) {
  test(`${scenario} evidence keeps retry and continuation blocked`, async t => {
    const { gate, ledgerPath } = await setup(t);
    const receipt = readLedger(ledgerPath)[0];
    const rows = scenario === 'absent' ? []
      : scenario === 'duplicate' ? [receipt, { ...receipt, refundId: 'another-refund' }]
      : scenario === 'wrong amount' ? [{ ...receipt, amountCents: 90000 }]
      : [{ ...receipt, refundId: '' }];
    writeFileSync(ledgerPath, rows.map(row => JSON.stringify(row)).join('\n'));
    assert.equal((await gate.reconcile(input.actionId)).state, 'NEEDS_REVIEW');
    await assert.rejects(gate.execute(input), { code: 'RETRY_BLOCKED' });
    assert.throws(() => gate.assertMayAdvance(input.actionId), { code: 'CONTINUATION_BLOCKED' });
    assert.equal(readLedger(ledgerPath).length, rows.length);
    // Later authoritative evidence can resolve the action, without resending the refund.
    writeFileSync(ledgerPath, JSON.stringify(receipt) + '\n');
    assert.equal((await gate.reconcile(input.actionId)).state, 'COMMITTED');
    assert.equal(gate.get(input.actionId).attempts.length, 1);
  });
}

test('provider read failure leaves UNKNOWN and a later read can recover', async t => {
  const { gate, ledgerPath } = await setup(t);
  const receipt = readLedger(ledgerPath)[0];
  writeFileSync(ledgerPath, 'corrupt ledger');
  const unresolved = await gate.reconcile(input.actionId);
  assert.equal(unresolved.state, 'UNKNOWN');
  assert.match(unresolved.reconciliations[0].error, /HTTP 500/);
  await assert.rejects(gate.execute(input), { code: 'RETRY_BLOCKED' });
  assert.throws(() => gate.assertMayAdvance(input.actionId), { code: 'CONTINUATION_BLOCKED' });
  writeFileSync(ledgerPath, JSON.stringify(receipt));
  assert.equal((await gate.reconcile(input.actionId)).state, 'COMMITTED');
});

test('reconciliation refuses missing actions and a different provider', async t => {
  const { gate, options } = await setup(t);
  await assert.rejects(gate.reconcile('missing'), { code: 'ACTION_NOT_FOUND' });
  const wrongProvider = new AgentCommit({ ...options, providerUrl: 'http://127.0.0.1:1/refunds' });
  await assert.rejects(wrongProvider.reconcile(input.actionId), { code: 'INTENT_CONFLICT' });
  assert.equal(gate.get(input.actionId).state, 'UNKNOWN');
});
