# StartupOneFinality

Primeiro artefato técnico — [ST-15](https://linear.app/tiago-santo/issue/ST-15): reproduzir **commit → lost response → timeout → retry → R$1.600**.

## Executar

Requisito: Node.js 22 ou superior. Sem dependências; não é necessário `npm install`.

```sh
npm run demo
npm test
```

A demonstração inicia um provider HTTP em `127.0.0.1`, numa porta disponível, e um caller que solicita um refund de **R$800**. O provider grava o refund num ledger JSONL e executa `fsync` (`flush: true`) antes de deliberadamente suprimir a primeira resposta. O caller recebe timeout após um segundo e repete a mesma ação. O provider grava um segundo refund e responde normalmente: **duas entradas, total R$1.600**.

O log mostra commit, perda da resposta, timeout e retry nessa ordem. Cada execução cria seu próprio ledger em `.demo/run-*/refunds.jsonl`, informa seu caminho e encerra o servidor. O ledger permanece em disco para inspeção. Valores são inteiros em centavos: `80000 + 80000 = 160000`.

## O que o teste prova

- No instante do timeout, antes do retry, o primeiro refund de R$800 já está no disco.
- A ordem dos eventos é commit, resposta perdida, timeout e novo commit.
- O retry usa o mesmo `actionId`, mas gera outro `refundId`: o provider não deduplica.
- As duas entradas persistem após o encerramento do provider.
- Sem retry, o timeout deixa apenas R$800 aplicado; sem perda de resposta, ocorre apenas um refund.
- Entrada inválida não gera commit nem retry.

## Limites do simulador

O ledger representa o efeito financeiro aplicado; não há integração com um gateway nem movimentação de dinheiro real. A falha é injetada **depois** da gravação, deixando a conexão sem resposta até o caller expirar. Não é um timeout anterior ao commit nem um erro HTTP devolvido pelo provider.

Este é um simulador local, de um processo, sem autenticação, adequado apenas à reprodução. A primeira resposta é suprimida por instância do servidor. Não implementa Agent Commit, idempotência, reconciliação ou retry gate: o cliente é deliberadamente ingênuo para expor o problema que as próximas tarefas vão resolver.
