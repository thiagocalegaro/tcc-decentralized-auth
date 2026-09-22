# Validação da versão 0.1

Data: 18/09/2026. Ambiente: Windows, Node.js 22.23.1, TypeScript estrito, Chrome local, armazenamento em memória. O arquivo `package-lock.json` registra as versões instaladas. Esta validação cobre o protótipo EOA; não equivale a auditoria independente de segurança.

| Verificação | Resultado |
|---|---|
| `npm run typecheck` | Passou |
| `npm test` | 68 testes passaram; 20 testes PostgreSQL ignorados por ausência de `TEST_DATABASE_URL` |
| `npm run build` | Passou; interface gerada em `frontend/demo-web/dist` |
| `npm run test:e2e`, Chrome | 5 testes passaram |
| `npm audit` | Nenhuma vulnerabilidade conhecida reportada na árvore instalada, incluindo dependências de desenvolvimento |
| Revisão visual | Desktop e largura de 390px, estado sem carteira e área autenticada |

Os testes de navegador injetam um provedor de carteira apenas na página de teste. Um processo Node cria uma chave descartável e assina as mensagens de verdade. O navegador chama a API e o BFF reais por HTTP, sem simular as respostas de autenticação. Essa verificação não substitui um ensaio manual com a extensão MetaMask e suas telas de permissão.

## Evidências exercitadas

- Criação de mensagem SIWE e assinatura ERC-191 por uma EOA.
- Recusa de origem, rede, redirect e campos inesperados.
- Rejeição de assinatura de outra conta, mensagem alterada e desafio expirado.
- Consumo único de desafio e código mesmo sob concorrência.
- Vínculo de código a cliente, redirect e PKCE S256.
- Validação da asserção ES256, issuer, audience, expiração e identidade no BFF.
- Cookies HttpOnly e SameSite, rotação de sessão e bloqueio de login CSRF.
- Invalidação por logout e cancelamento de autenticação em andamento após logout ou novo fluxo.
- Expiração por inatividade e limite absoluto da sessão.
- Recusa de assinatura e mudança da carteira durante login, sem criar sessão.
- Recurso privado inacessível após logout; recarga mantém uma sessão válida.
- Ausência de credenciais em localStorage/sessionStorage.
- Migrações e adaptador PostgreSQL presentes; testes reais do banco preparados, sem alegação de execução local.

## Reproduzir no Windows

```powershell
npm.cmd ci
npm.cmd run setup
npm.cmd test
npm.cmd run build
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npm.cmd run test:e2e
npm.cmd audit
```

O canal `chrome` usa o Chrome instalado. Sem esse navegador, execute `npx.cmd playwright install chromium` e remova `PLAYWRIGHT_CHANNEL` antes de rodar Playwright. A configuração inicia os serviços do projeto se não houver instância de desenvolvimento ativa. Use `CI=true` para exigir uma instância nova durante a suíte.

## Limites observados

O Docker estava sem daemon ativo. Os 20 casos de PostgreSQL precisam rodar contra um banco real antes de adotar esse modo como base do experimento. O CI inclui um serviço PostgreSQL para essa finalidade, mas ainda não houve execução remota do workflow.

O BFF mantém sessões e fluxos em memória. Reiniciar esse serviço encerra as sessões. A versão não implementa ERC-1271, recuperação de carteira, gestão administrativa de clientes, rotação automática de chave de assinatura nem limites distribuídos entre instâncias. A primeira entrega permite executar e estudar o fluxo EOA de ponta a ponta.
