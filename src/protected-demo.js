import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentCommit } from './agent-commit.js';
import { startProvider, readLedger } from './provider.js';

mkdirSync('.demo', { recursive: true });
const directory = mkdtempSync(resolve('.demo', 'protected-'));
const ledgerPath = join(directory, 'refunds.jsonl');
const provider = await startProvider({ ledgerPath });
const gate = new AgentCommit({ directory: join(directory, 'effects'), providerUrl: provider.url });
const input = { actionId: 'refund-order-001', amountCents: 80000 };
try {
  try { await gate.execute(input); }
  catch (error) { if (error.code !== 'OUTCOME_UNKNOWN') throw error; console.log(error.code); }
  const record = gate.get(input.actionId);
  console.log(`Effect: ${record.effect_id}`);
  console.log(record.history.map(event => event.state).join(' → '));
  try { await gate.execute(input); }
  catch (error) { if (error.code !== 'RETRY_BLOCKED') throw error; console.log(error.code); }
  try { gate.assertMayAdvance(input.actionId); }
  catch (error) { if (error.code !== 'CONTINUATION_BLOCKED') throw error; console.log(error.code); }
  const ledger = readLedger(ledgerPath);
  const total = ledger.reduce((sum, item) => sum + item.amountCents, 0);
  if (ledger.length !== 1 || total !== 80000 || record.state !== 'UNKNOWN') throw new Error('Unexpected result');
  console.log('Total aplicado no provider: R$800 (1 refund). A camada continua em UNKNOWN.');
  console.log(`Arquivos: ${directory}`);
} finally { await provider.close(); }
