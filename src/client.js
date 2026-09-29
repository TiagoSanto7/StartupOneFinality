import http from 'node:http';

export async function readbackRefunds(providerUrl, actionId, timeoutMs = 1000) {
  const url = new URL(providerUrl);
  url.searchParams.set('actionId', actionId);
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  if (!response.ok) throw new Error(`Readback HTTP ${response.status}`);
  return response.json();
}

export function requestRefund(url, refund, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        clearTimeout(timer);
        if (res.statusCode !== 201) return reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
        try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
      });
    });
    const timer = setTimeout(() => {
      const error = new Error('Refund response timed out; outcome unknown');
      error.code = 'ETIMEDOUT';
      req.destroy(error);
    }, timeoutMs);
    req.on('error', error => { clearTimeout(timer); reject(error); });
    req.end(JSON.stringify(refund));
  });
}

// Intentionally unsafe: a timeout is treated as permission to repeat the action.
export async function naiveRefund(url, refund, { timeoutMs = 1000, onEvent = () => {} } = {}) {
  onEvent({ type: 'attempt', attempt: 1 });
  try {
    return await requestRefund(url, refund, timeoutMs);
  } catch (error) {
    if (error.code !== 'ETIMEDOUT') throw error;
    onEvent({ type: 'timeout' });
    onEvent({ type: 'attempt', attempt: 2 });
    return requestRefund(url, refund, timeoutMs);
  }
}
