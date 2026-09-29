import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runComparison } from './comparison.js';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
export async function startDashboard({ port = 0, root = resolve('.demo') } = {}) {
  let busy = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'POST' && req.url === '/api/run') {
      if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${server.address().port}`) {
        res.writeHead(403).end(); return;
      }
      if (busy) { res.writeHead(409).end('A comparison is already running'); return; }
      busy = true;
      try {
        const result = await runComparison(root);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        console.error(error);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Falha na execução. Consulte o terminal e tente novamente.' }));
      } finally { busy = false; }
      return;
    }
    const asset = assets.get(req.url);
    if (req.method !== 'GET' || !asset) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': asset[1] });
    res.end(readFileSync(new URL(`../public/${asset[0]}`, import.meta.url)));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => {
    server.close(resolve); server.closeAllConnections();
  }) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dashboard = await startDashboard({ port: Number(process.env.PORT ?? 3000) });
  console.log(`Agent Commit — painel: ${dashboard.url}`);
}
