const $ = id => document.getElementById(id);
const money = value => (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const labels = {
  PREPARED: 'Intenção registrada', DISPATCHED: 'Pedido enviado ao provider',
  PROVIDER_COMMIT: 'R$800 persistidos no ledger', RESPONSE_LOST: 'Confirmação perdida após commit',
  TIMEOUT: 'Caller não sabe o resultado', RETRY: 'Mesmo pedido enviado novamente',
  UNKNOWN: 'Resultado incerto; não é falha', RETRY_BLOCKED: 'Novo estorno impedido',
  CONTINUATION_BLOCKED: 'Workflow aguarda confirmação', RECONCILING: 'Consulta à evidência do provider',
  COMMITTED: 'Efeito confirmado pela evidência', MAY_ADVANCE: 'Workflow liberado',
};
let result;
function reset() {
  for (const side of ['naive', 'protected']) {
    $(`${side}-events`).replaceChildren(); $(`${side}-total`).textContent = '—';
    $(`${side}-count`).textContent = 'Aguardando resultado'; $(`${side}-badge`).textContent = 'Executando';
  }
  $('verdict').textContent = 'Confirmar o efeito antes de autorizar o próximo passo.';
  $('run-id').textContent = 'HTTP real · persistência em disco';
}
async function show(animate) {
  reset(); $('run').disabled = $('replay').disabled = $('download').disabled = true;
  $('status').textContent = 'Reproduzindo eventos da execução real concluída…';
  const length = Math.max(result.naive.events.length, result.protected.events.length);
  const counts = { naive: 0, protected: 0 };
  for (let i = 0; i < length; i++) {
    for (const side of ['naive', 'protected']) {
      const event = result[side].events[i]; if (!event) continue;
      const row = document.createElement('li');
      if (['RETRY', 'RETRY_BLOCKED', 'MAY_ADVANCE', 'UNKNOWN'].includes(event.type)) row.className = 'hot';
      const title = document.createElement('b'); title.textContent = event.type.replaceAll('_', ' ');
      const text = document.createElement('span'); text.textContent = labels[event.type] ?? event.type;
      row.append(title, text); $(`${side}-events`).append(row);
      if (event.type === 'PROVIDER_COMMIT') counts[side] += event.refund.amountCents;
      $(`${side}-total`).textContent = money(counts[side]);
      $(`${side}-count`).textContent = 'Eventos confirmados no provider';
    }
    if (animate) await new Promise(resolve => setTimeout(resolve, 230));
  }
  for (const side of ['naive', 'protected']) {
    $(`${side}-total`).textContent = money(result[side].totalCents);
    $(`${side}-count`).textContent = `${result[side].refunds.length} estorno(s) aplicado(s)`;
  }
  $('naive-badge').textContent = 'EFEITO DUPLICADO'; $('protected-badge').textContent = 'MAY_ADVANCE';
  $('verdict').textContent = 'R$800 de duplicação evitada. Uma intenção, um estorno confirmado.';
  $('run-id').textContent = result.runId;
  $('status').textContent = 'Concluído · totais verificados nos ledgers persistidos.';
  $('run').disabled = $('replay').disabled = $('download').disabled = false;
  $('run').firstChild.textContent = 'Executar novamente ';
}
$('run').addEventListener('click', async () => {
  reset(); result = null;
  $('run').disabled = $('replay').disabled = $('download').disabled = true;
  $('status').textContent = 'Executando HTTP, timeout, retry e reconciliação…';
  try {
    const response = await fetch('/api/run', { method: 'POST' });
    if (!response.ok) throw new Error('A execução falhou. Verifique o terminal e tente novamente.');
    result = await response.json();
    await show(!matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (error) {
    $('status').textContent = error.message; $('run').disabled = false;
    for (const side of ['naive', 'protected']) $(`${side}-badge`).textContent = 'Falha na execução';
  }
});
$('replay').addEventListener('click', () => show(!matchMedia('(prefers-reduced-motion: reduce)').matches));
$('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `${result.runId}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
