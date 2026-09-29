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

Este é um simulador local, sem autenticação, adequado apenas à reprodução. A primeira resposta é suprimida por instância do servidor. O comando `demo` mantém o cliente deliberadamente ingênuo da ST-15.

## ST-16: identidade persistente e bloqueio de retry

```sh
npm run demo:protected
```

A camada `AgentCommit` fica entre caller e provider. Ela persiste um `EffectCommitRecord` com `effect_id`, intenção canônica, tentativas de envio e histórico de estados. O caller deve reutilizar o mesmo `actionId` para a mesma ação lógica; mudar esse identificador representa uma nova ação. Reutilizá-lo com outro valor ou provider gera `INTENT_CONFLICT`.

Antes do envio, a camada salva `PREPARED → DISPATCHED`. Se a resposta se perder, salva `UNKNOWN`. Uma segunda chamada retorna `RETRY_BLOCKED` sem enviar outro refund. `assertMayAdvance(actionId)` também bloqueia a continuação dependente. A demo imprime **R$800** lendo o ledger para comprovação externa; a camada permanece em **UNKNOWN**, pois ainda não consultou a evidência do provider.

Uma resposta válida recebida normalmente permite `COMMITTED`; chamadas repetidas retornam o registro confirmado sem novo envio. A reconciliação de resultados ambíguos é a ST-17. O painel comparativo é a ST-18.

Os registros ficam em `.demo/protected-*/effects`. Para preservar identidade após reiniciar, reutilize o diretório de registros e o mesmo endereço do provider. Cada execução da demo usa um diretório novo para isolar o cenário.

### Persistência e limites

- Escrita em arquivo temporário com `fsync`, seguida de renomeação; leitores encontram um registro completo.
- Um diretório de lock por ação serializa as alterações entre instâncias que compartilham o mesmo armazenamento local. Durante a chamada HTTP, `DISPATCHED` já bloqueia outros envios.
- Se o processo parar após persistir `DISPATCHED`, a ação continua bloqueada. Se parar segurando um lock, esse lock exige inspeção manual com os processos parados; não há expiração automática que possa liberar um retry inseguro.
- Erros após dispatch são tratados conservadoramente como `UNKNOWN`. Falhas de armazenamento propagam erro e não autorizam continuação.
- Não é armazenamento distribuído nem uma garantia contra falha física de disco/energia. A aplicação precisa passar todos os envios por esta camada e chamar o gate antes de continuar; ela não intercepta chamadas que a contornem.

Os testes incluem perda de resposta, identidade após recarregar o armazenamento, chamadas concorrentes, intenção conflitante, reutilização de resposta confirmada, recuperação de `DISPATCHED` e falhas locais de armazenamento.
