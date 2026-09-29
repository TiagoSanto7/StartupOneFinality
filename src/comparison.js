import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentCommit } from './agent-commit.js';
import { naiveRefund } from './client.js';
import { startProvider, readLedger } from './provider.js';

export async function runComparison(root, timeoutMs = 1000) {
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'comparison-'));
  const input = { actionId: 'refund-order-001', amountCents: 80000 };
  async function scenario(protectedMode) {
    const name = protectedMode ? 'protected' : 'naive';
    const ledgerPath = join(directory, `${name}.jsonl`);
    const events = [];
    const emit = (type, detail = {}) => events.push({ type, at: new Date().toISOString(), ...detail });
    const provider = await startProvider({ ledgerPath, onEvent: event => emit(
      event.type === 'committed' ? 'PROVIDER_COMMIT' : 'RESPONSE_LOST', { refund: event.refund }) });
    let record;
    try {
      if (protectedMode) {
        class TracedCommit extends AgentCommit {
          transition(value, state) { super.transition(value, state); emit(state); }
        }
        const gate = new TracedCommit({ directory: join(directory, 'effects'), providerUrl: provider.url, timeoutMs });
        try { await gate.execute(input); }
        catch (error) { if (error.code !== 'OUTCOME_UNKNOWN') throw error; }
        try { await gate.execute(input); throw new Error('Retry was not blocked'); }
        catch (error) { if (error.code !== 'RETRY_BLOCKED') throw error; emit('RETRY_BLOCKED'); }
        try { gate.assertMayAdvance(input.actionId); throw new Error('Continuation was not blocked'); }
        catch (error) { if (error.code !== 'CONTINUATION_BLOCKED') throw error; emit('CONTINUATION_BLOCKED'); }
        record = await gate.reconcile(input.actionId);
        emit(gate.assertMayAdvance(input.actionId).decision);
      } else {
        await naiveRefund(provider.url, input, { timeoutMs, onEvent: event => emit(
          event.type === 'timeout' ? 'TIMEOUT' : event.attempt === 1 ? 'DISPATCHED' : 'RETRY') });
      }
      const refunds = readLedger(ledgerPath);
      return { events, refunds, totalCents: refunds.reduce((sum, row) => sum + row.amountCents, 0), record };
    } finally { await provider.close(); }
  }
  // allSettled ensures both providers have closed even when one scenario fails.
  const outcomes = await Promise.allSettled([scenario(false), scenario(true)]);
  const failed = outcomes.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  const result = { runId: directory.split(/[\\/]/).at(-1), input,
    naive: outcomes[0].value, protected: outcomes[1].value };
  if (result.naive.totalCents !== 160000 || result.protected.totalCents !== 80000) {
    throw new Error('Unexpected comparison totals');
  }
  writeFileSync(join(directory, 'comparison.json'), JSON.stringify(result, null, 2));
  return result;
}
