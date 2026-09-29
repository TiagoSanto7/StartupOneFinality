import http from 'node:http';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export function readLedger(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

// Fault injection is per server instance: only its first committed refund loses a response.
export async function startProvider({ ledgerPath, loseFirstResponse = true, onEvent = () => {} }) {
  let committed = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/refunds') {
      const actionId = url.searchParams.get('actionId');
      if (!actionId) { res.writeHead(400).end('Missing actionId'); return; }
      try {
        const refunds = readLedger(ledgerPath).filter(refund => refund.actionId === actionId);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ refunds }));
      } catch { res.writeHead(500).end('Readback failed'); }
      return;
    }
    if (req.method !== 'POST' || req.url !== '/refunds') {
      res.writeHead(404).end();
      return;
    }
    let body;
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      body = JSON.parse(raw);
      if (!body.actionId || !Number.isSafeInteger(body.amountCents) || body.amountCents <= 0) {
        throw new Error('Invalid refund');
      }
    } catch {
      res.writeHead(400).end('Invalid refund');
      return;
    }

    const refund = { refundId: randomUUID(), actionId: body.actionId, amountCents: body.amountCents };
    try {
      // flush:true fsyncs the ledger before returning. This is the simulated financial commit.
      appendFileSync(ledgerPath, JSON.stringify(refund) + '\n', { flush: true });
    } catch {
      res.writeHead(500).end('Commit failed');
      return;
    }
    committed += 1;
    onEvent({ type: 'committed', refund });
    if (loseFirstResponse && committed === 1) {
      onEvent({ type: 'response_lost', refund });
      // Deliberately send no headers/body. Caller times out; its disconnect cannot undo the commit.
      return;
    }
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify(refund));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/refunds`,
    close: () => new Promise((resolve, reject) => {
      if (!server.listening) return resolve();
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
