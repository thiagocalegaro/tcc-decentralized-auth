# Âncora

Provedor de autenticação por carteira EVM com OpenID Connect (OIDC). O usuário assina uma mensagem SIWE; o Âncora verifica a assinatura e entrega a identidade ao backend do site por Authorization Code com PKCE. O login não envia transações nem exige saldo.

Este repositório contém o provedor, as telas de login e consentimento, o portal do desenvolvedor, o SDK Node.js e duas aplicações de demonstração completas: **Biblioteca** e **Observatório**. As demos têm frontend, backend e área restrita próprios e usam o mesmo Âncora para demonstrar SSO.

## Iniciar tudo com Docker Compose

Requisito: Docker com Compose v2 ou superior. No Windows e macOS, deixe o Docker Desktop aberto; use contêineres Linux. Não é necessário instalar Node.js no computador para executar o ambiente.

Na raiz do projeto:

```sh
docker compose up --build -d --wait
```

O primeiro início instala as dependências, compila o projeto, gera as chaves e cadastra as duas demos automaticamente. Os próximos inícios preservam os dados. Não é necessário criar um arquivo `.env` nem cadastrar as demos manualmente.

| Componente | Endereço |
| --- | --- |
| Portal do desenvolvedor Âncora | http://localhost:4200/portal |
| Página pública do Âncora | http://localhost:4200 |
| Demo Biblioteca | http://localhost:4201 |
| Demo Observatório | http://localhost:4202 |
| Descoberta OIDC | http://localhost:4200/.well-known/openid-configuration |

Use **localhost** nos endereços. Não substitua por `127.0.0.1`: o issuer OIDC, os callbacks e as origens verificadas precisam coincidir.

O `compose.yaml` centraliza build, endereços, portas, verificação de saúde e armazenamento. O serviço `ancora` executa o provedor e as duas demos no mesmo processo Node, em três portas. Isso mantém `localhost` acessível tanto pelo navegador quanto pelas chamadas OIDC entre os aplicativos. Os sites têm bancos e sessões separados, mas este ambiente local não simula isolamento entre máquinas.

As portas são publicadas somente no loopback do computador. O Compose usa HTTP local e `NODE_ENV=development`; a assinatura da carteira, PKCE, validação dos tokens e proteção das rotas continuam ativas. A configuração é voltada a desenvolvimento e demonstração local.

## Testar o login e o SSO

1. Abra a Biblioteca e clique em **Entrar com Âncora**.
2. No login hospedado, conecte uma extensão de carteira EVM e assine a mensagem. Use Ethereum ou Sepolia; não é necessário saldo.
3. Autorize o acesso. A Biblioteca recebe a identidade verificada e abre `/arearestrita`, mostrando a carteira e o usuário local.
4. Abra o Observatório no mesmo navegador e entre. Enquanto a sessão do Âncora estiver válida, o segundo site pede consentimento sem exigir outra assinatura.
5. Saia apenas do Observatório: a sessão da Biblioteca continua válida.
6. Abra uma janela anônima e tente acessar `http://localhost:4201/arearestrita`: a página redireciona para o início e `/api/private` retorna 401.

As demos vinculam a identidade `(issuer, sub)` a um usuário do próprio banco. Cada site recebe `issuer`, `sub`, `address` e `chainId`; os IDs locais podem ser diferentes para a mesma carteira. Nenhum token é colocado no localStorage.

O portal permite entrar com a carteira e cadastrar outras aplicações. Os clientes das demos são criados pelo setup, sem proprietário, e não aparecem na lista pessoal do desenvolvedor.

## Comandos e persistência

```sh
docker compose ps
docker compose logs -f ancora
docker compose stop
docker compose start --wait
docker compose down
```

Para aplicar alterações de código, execute novamente `docker compose up --build -d --wait`.

O volume nomeado `ancora-data` (normalmente `ancora_ancora-data` no Docker) guarda chaves, configurações, cadastros, usuários e sessões em `/data`. As sessões continuam sujeitas à expiração normal. `stop`, `down` e a reconstrução da imagem preservam esse volume. O Compose não usa nem altera a pasta `.local/` do computador.

**Reinicialização destrutiva:** `docker compose down --volumes` remove os dados deste ambiente, incluindo chaves e credenciais. Use somente se quiser começar do zero; aplicações cadastradas precisarão ser configuradas novamente.

Bancos, credenciais, `.env`, dependências e artefatos gerados são ignorados pelo Git e pelo contexto de build. Faça backup consistente do volume com o serviço parado.

## Executar sem Docker

Requer Node.js 22.13 ou superior e npm.

Para iniciar o provedor e as duas demos:

```sh
npm ci
npm run build
npm run dev:demos
```

No Windows, `INICIAR_DEMOS.cmd` executa essa sequência. O ambiente usa `.local/demos/` por padrão.

Para iniciar somente o Âncora, com o portal:

```sh
npm ci
npm run build
npm start
```

No Windows, também pode usar `INICIAR.cmd`. O provedor isolado usa `.local/` e não cadastra as demos. `npm run setup` continua disponível para gerar antecipadamente a configuração. `ANCORA_DATA_DIR` permite selecionar outro diretório persistente.

Não execute Docker e os launchers locais ao mesmo tempo nas mesmas portas.

## Organização

```text
compose.yaml                  Ambiente local completo
Dockerfile                    Build e imagem de execução
core/apps/provider/           Provedor OIDC, SIWE e API do portal
core/apps/demo/               Backend e vínculo de usuários das duas demos
core/packages/node-sdk/       Biblioteca de servidor @ancora/node
frontend/hosted-login/         Login por carteira e consentimento
frontend/portal/               Página pública e portal do desenvolvedor
frontend/demo/                 Interfaces das demos e área restrita
frontend/shared/               Estilos e identidade visual
scripts/                      Setup, execução e healthcheck
tests/                        Testes de protocolo, persistência e navegador
docs/                         Integração, arquitetura e operação
deploy/                       Modelos opcionais de implantação futura
```

A API e o backend ficam em `core/`; as interfaces ficam em `frontend/`. O backend serve os arquivos das interfaces e protege a página restrita: ocultar uma tela no navegador não substitui a autenticação no servidor.

## Integrar sua aplicação

1. Acesse o portal, entre com sua carteira e cadastre origem, callback e retorno de logout do site.
2. Guarde o client ID e o segredo no backend da aplicação.
3. Use o [SDK Node.js](core/packages/node-sdk/README.md) ou um cliente OIDC compatível, com PKCE S256 e escopos `openid wallet`.
4. Vincule a identidade verificada ao usuário local por uma chave única `(issuer, sub)`.

O SDK entrega `issuer`, `sub`, `address` e `chainId` à função `onLogin`. O retorno opcional `{ userId }` fica disponível na sessão local. Cada aplicação protege suas próprias páginas e APIs. Veja [o passo a passo](docs/INTEGRACAO.md) e o exemplo funcional em `core/apps/demo/app.ts`.

O pacote não está publicado no npm. Em um checkout com Node e dependências instaladas, `npm run pack:sdk` gera o arquivo instalável em `.local/`.

## Verificar

Com Node.js e as dependências instaladas no computador:

```sh
npm run build
npm test
npm run test:e2e
npm run test:e2e:demos
```

Os testes de navegador padrão verificam o portal; a suíte das demos verifica login, SSO, logout, rejeição de assinaturas e proteção da área restrita. Ambas iniciam ambientes temporários nas portas 4400–4402 e não usam os dados do Compose.

Para verificar demos, portal e identidade visual dentro do contêiner já iniciado:

```sh
docker compose up --build -d --wait
npm run test:e2e:compose
```

Essa suíte utiliza os endereços 4200–4202 e cria usuários de teste no ambiente do Compose. As carteiras simuladas assinam mensagens reais com chaves descartáveis; não há bypass de autenticação no servidor.

O [GitHub Actions](https://github.com/thiagocalegaro/tcc-decentralized-auth/actions/workflows/verify.yml) também constrói a imagem, executa esses testes com Chromium e verifica que chaves, credenciais e usuários das demos sobrevivem à recriação do contêiner.

O navegador padrão é Microsoft Edge. Para usar Chromium, instale-o com `npx playwright install chromium` e defina `PLAYWRIGHT_CHANNEL=chromium` no terminal. Os relatórios ficam em `playwright-report/` e `test-results/`.

## Diagnóstico

| Sintoma | O que conferir |
| --- | --- |
| Docker não conecta ao engine | Inicie o Docker Desktop e selecione contêineres Linux |
| Porta já está em uso | Encerre o launcher local ou outro serviço nas portas 4200–4202 |
| Contêiner não fica saudável | Consulte `docker compose logs ancora`; os três endpoints de saúde precisam responder |
| Falha no callback ou na assinatura | Use exatamente `localhost` e os endereços cadastrados |
| Interface não mudou após editar | Reconstrua com `docker compose up --build -d --wait` |
| Carteira não aparece | Instale/habilite uma extensão EVM; esta versão não inclui WalletConnect/QR |

## Documentação e limites

- [Integração e vínculo de usuários](docs/INTEGRACAO.md)
- [Arquitetura e segurança](docs/ARQUITETURA.md)
- [Operação e backups](docs/OPERACAO.md)
- [Modelos para implantação futura em VPS](docs/DEPLOY.md)

Protótipo acadêmico para testes de integração. A identidade é baseada em carteira, mas a emissão de tokens depende do servidor Âncora. A implementação cobre contas EOA; não inclui carteiras ERC-1271, WalletConnect ou recuperação de chaves. Não há certificação OIDC desta implantação nem logout global das sessões dos sites.
