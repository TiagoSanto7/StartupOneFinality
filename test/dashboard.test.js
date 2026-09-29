import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboard } from '../src/dashboard.js';

test('dashboard executes isolated real comparisons and serves only known assets', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dashboard-test-'));
  const dashboard = await startDashboard({ root });
  t.after(async () => { await dashboard.close(); rmSync(root, { recursive: true, force: true }); });
  assert.match(await (await fetch(dashboard.url)).text(), /Executar comparação/);
  assert.equal((await fetch(dashboard.url + '/src/agent-commit.js')).status, 404);
  assert.equal((await fetch(dashboard.url + '/api/run', {
    method: 'POST', headers: { origin: 'https://example.com' },
  })).status, 403);
  let previousId;
  for (let attempt = 0; attempt < 2; attempt++) {
    const pending = fetch(dashboard.url + '/api/run', { method: 'POST' });
    if (attempt === 0) {
      const second = await fetch(dashboard.url + '/api/run', { method: 'POST' });
      assert.equal(second.status, 409);
    }
    const response = await pending;
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.notEqual(result.runId, previousId); previousId = result.runId;
    assert.equal(result.naive.totalCents, 160000);
    assert.equal(result.protected.totalCents, 80000);
    assert.equal(result.protected.record.attempts.length, 1);
    assert.equal(result.protected.record.state, 'COMMITTED');
    assert.deepEqual(result.protected.events.map(event => event.type), [
      'PREPARED', 'DISPATCHED', 'PROVIDER_COMMIT', 'RESPONSE_LOST', 'UNKNOWN',
      'RETRY_BLOCKED', 'CONTINUATION_BLOCKED', 'RECONCILING', 'COMMITTED', 'MAY_ADVANCE',
    ]);
    assert.deepEqual(JSON.parse(readFileSync(join(root, result.runId, 'comparison.json'), 'utf8')), result);
  }
});
