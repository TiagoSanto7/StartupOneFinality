# Physical AI — Future Vision (ST-27)

Simulação visual curta ligada a [ST-27](https://linear.app/tiago-santo/issue/ST-27). **Não é o produto atual.** É uma extensão conceitual do mesmo problema de controle do Agent Commit (ST-15/16/17), aplicada a um cenário físico hipotético, usada apenas no slide/roadmap de visão do pitch.

## O que a demo mostra

Um robô (representado como um gantry simples) recebe a tarefa "Move box to Zone B", move a caixa e o controller reporta `SUCCESS`. Uma camada de verificação observa o estado físico real: a caixa não está corretamente dentro da Zone B. O veredito aparece como `NOT_VERIFIED` e a próxima decisão é `REPLAN`.

Fluxo completo, em ~10 segundos:

```
TASK "Move box to Zone B"
  → robô move a caixa
  → CONTROLLER: SUCCESS
  → verificação observa o mundo (scan da Zone B)
  → EXPECTED: box ∈ Zone B · OBSERVED: false
  → FINALITY: NOT_VERIFIED
  → NEXT ACTION: REPLAN
```

A mensagem é a mesma control question do Agent Commit, só que no mundo físico: *"o controller terminar não significa que o estado esperado do mundo foi atingido; antes de continuar, é preciso verificar o estado real."*

## Executar

Requisito: Node.js 22 ou superior. Sem dependências (`three.js` é carregado via CDN pelo navegador; não há `npm install`).

```sh
npm run demo:physical
```

Abra o endereço impresso no terminal (`http://127.0.0.1:3100` por padrão; use `$env:PORT=3101; npm run demo:physical` no PowerShell se a porta estiver ocupada). A animação começa sozinha e repete ao final; use **Rever simulação** para reiniciar a qualquer momento — útil para gravar vídeo ou tirar screenshot.

Alternativa sem servidor: o arquivo `physical-vision-demo/index.html` também pode ser aberto diretamente no navegador (duplo clique), já que não há chamadas de backend — apenas certifique-se de ter internet para carregar o `three.js` do CDN.

## O que esta demo NÃO é

- Não controla nenhum robô real; não há integração com ROS ou motores físicos.
- Não é o produto atual da empresa nem uma promessa de robótica funcionando hoje.
- Não usa física realista; é uma visualização propositalmente simples (Three.js, geometrias básicas, movimento interpolado).
- Não representa um roadmap comprometido — é ilustração de uma categoria futura (**Verified Action Finality**) aplicada além do domínio digital.

A tag "FUTURE VISION — CONCEPTUAL EXTENSION" permanece visível durante toda a animação, inclusive dentro da área de captura de tela/vídeo, para que nenhum recorte da demo sugira que isto já é um produto.
