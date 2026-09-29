import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { startProvider, readLedger } from './provider.js';
import { naiveRefund } from './client.js';

mkdirSync('.demo', { recursive: true });
const ledgerPath = join(mkdtempSync(resolve('.demo', 'run-')), 'refunds.jsonl');
const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const provider = await startProvider({ ledgerPath, onEvent: event => {
  console.log(event.type === 'committed'
    ? `Provider: COMMIT persistido de ${money(event.refund.amountCents)} (${event.refund.refundId})`
    : 'Provider: resposta perdida DEPOIS do commit');
} });
try {
  await naiveRefund(provider.url, { actionId: 'refund-order-001', amountCents: 80000 }, {
    onEvent: event => console.log(event.type === 'timeout'
      ? 'Caller: TIMEOUT; resultado desconhecido'
      : `Caller: tentativa ${event.attempt} da mesma ação de R$800`),
  });
  const refunds = readLedger(ledgerPath);
  const total = refunds.reduce((sum, refund) => sum + refund.amountCents, 0);
  console.log(`Total aplicado: ${money(total)} (${refunds.length} refunds)`);
  console.log(`Ledger: ${ledgerPath}`);
  if (refunds.length !== 2 || total !== 160000) throw new Error('Unexpected scenario result');
} finally {
  await provider.close();
}
