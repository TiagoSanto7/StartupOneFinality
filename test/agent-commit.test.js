import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentCommit } from '../src/agent-commit.js';
import { startProvider, readLedger } from '../src/provider.js';

const input = { actionId: 'order-001-refund', amountCents: 80000 };
async function setup(t, providerOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'commit-test-'));
  const ledgerPath = join(directory, 'refunds.jsonl');
  const provider = await startProvider({ ledgerPath, ...providerOptions });
  const options = { directory: join(directory, 'effects'), providerUrl: provider.url, timeoutMs: 500 };
  const gate = new AgentCommit(options);
  t.after(async () => { await provider.close(); rmSync(directory, { recursive: true, force: true }); });
  return { gate, options, ledgerPath };
}

test('lost response persists UNKNOWN and blocks retry and continuation across reload', async t => {
  const { gate, options, ledgerPath } = await setup(t);
  await assert.rejects(gate.execute(input), error => {
    assert.equal(error.code, 'OUTCOME_UNKNOWN');
    assert.equal(error.cause.code, 'ETIMEDOUT');
    return true;
  });
  const before = gate.get(input.actionId);
  assert.deepEqual(before.history.map(event => event.state), ['PREPARED', 'DISPATCHED', 'UNKNOWN']);
  assert.deepEqual(before.intent.input, input);
  const reloaded = new AgentCommit(options);
  for (let count = 0; count < 3; count++) {
    await assert.rejects(reloaded.execute(input), { code: 'RETRY_BLOCKED' });
    assert.throws(() => reloaded.assertMayAdvance(input.actionId), { code: 'CONTINUATION_BLOCKED' });
  }
  assert.equal(reloaded.get(input.actionId).effect_id, before.effect_id);
  assert.equal(reloaded.get(input.actionId).attempts.length, 1);
  assert.deepEqual(readLedger(ledgerPath).map(row => row.amountCents), [80000]);
});

test('concurrent callers cannot dispatch the same effect twice', async t => {
  const { gate, options, ledgerPath } = await setup(t);
  const results = await Promise.allSettled([gate.execute(input), new AgentCommit(options).execute(input)]);
  assert.deepEqual(results.map(result => result.reason.code), ['OUTCOME_UNKNOWN', 'RETRY_BLOCKED']);
  assert.equal(readLedger(ledgerPath).length, 1);
});

test('confirmed response is reused without a second refund, even with reordered input keys', async t => {
  const { gate, ledgerPath } = await setup(t, { loseFirstResponse: false });
  const first = await gate.execute(input);
  const second = await gate.execute({ amountCents: 80000, actionId: input.actionId });
  assert.equal(first.state, 'COMMITTED');
  assert.equal(second.effect_id, first.effect_id);
  assert.equal(second.receipt.refundId, first.receipt.refundId);
  assert.equal(gate.assertMayAdvance(input.actionId).state, 'COMMITTED');
  assert.equal(readLedger(ledgerPath).length, 1);
  await assert.rejects(gate.execute({ ...input, amountCents: 90000 }), { code: 'INTENT_CONFLICT' });
  assert.equal(readLedger(ledgerPath).length, 1);
});

test('recovered DISPATCHED record remains blocked after an interrupted process', async t => {
  const { gate, options, ledgerPath } = await setup(t);
  const pending = gate.execute(input);
  // execute writes DISPATCHED synchronously before returning its pending network promise.
  const dispatched = gate.get(input.actionId);
  assert.equal(dispatched.state, 'DISPATCHED');
  await assert.rejects(pending, { code: 'OUTCOME_UNKNOWN' });
  // Restore the durable snapshot that would survive termination while awaiting the response.
  writeFileSync(gate.path(input.actionId), JSON.stringify(dispatched));
  const recovered = new AgentCommit(options);
  await assert.rejects(recovered.execute(input), { code: 'RETRY_BLOCKED' });
  assert.throws(() => recovered.assertMayAdvance(input.actionId), { code: 'CONTINUATION_BLOCKED' });
  assert.equal(readLedger(ledgerPath).length, 1);
});

test('invalid inputs and missing effects never authorize continuation or dispatch', async t => {
  const { gate, ledgerPath } = await setup(t);
  for (const invalid of [{ ...input, amountCents: -1 }, { ...input, extra: true }, { ...input, actionId: '' }]) {
    await assert.rejects(gate.execute(invalid), { code: 'INVALID_INPUT' });
  }
  assert.throws(() => gate.assertMayAdvance(input.actionId), { code: 'CONTINUATION_BLOCKED' });
  assert.deepEqual(readLedger(ledgerPath), []);
});

test('corrupt storage and occupied lock fail closed before dispatch', async t => {
  const { gate, ledgerPath } = await setup(t);
  const path = gate.path(input.actionId);
  writeFileSync(path, 'broken json');
  await assert.rejects(gate.execute(input), SyntaxError);
  rmSync(path);
  mkdirSync(path + '.lock');
  await assert.rejects(gate.execute(input), { code: 'ACTION_BUSY' });
  assert.deepEqual(readLedger(ledgerPath), []);
});
