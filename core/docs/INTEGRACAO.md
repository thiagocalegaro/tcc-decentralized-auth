# Integração do Âncora para desenvolvedores

Use o [guia visual e interativo](../../docs/index.html#integracao) para acompanhar as etapas e copiar os exemplos. Esta referência descreve o SDK e o contrato HTTP implementados no repositório.

O frontend usa o SDK no navegador e acessa o BFF pela mesma origem pública. O BFF guarda o segredo do cliente, o verificador PKCE e a sessão. A API verifica a assinatura e emite asserções ES256. O protocolo é próprio; esta versão não oferece um provedor OAuth 2.0/OpenID Connect.

## 1. Prepare o ambiente

Requisitos: Node.js 22.12 ou superior, npm, Git e uma carteira de navegador com conta EOA. Use Ethereum (chain ID 1) ou Sepolia (11155111), conforme a configuração. O login por assinatura dispensa saldo. No modo em memória, você não precisa de PostgreSQL.

Em uma pasta nova, execute no PowerShell:

~~~powershell
git clone https://github.com/thiagocalegaro/tcc-decentralized-auth.git
Set-Location -LiteralPath 'tcc-decentralized-auth'
npm ci
npm run setup
npm run dev
~~~

No Linux/macOS, substitua Set-Location por cd. Se você já tem o projeto em C:\Users\get10\projetos IA\TCC II, entre nessa pasta e comece em npm ci.

O setup gera .env, CLIENT_SECRET e a chave ES256 em .local/signing-key.json, preservando arquivos existentes. O comando dev inicia os três processos. Confira:

| Serviço | Endereço | Resultado |
| --- | --- | --- |
| Frontend | http://localhost:5173 | Página de login |
| API | http://localhost:3001/health/ready | HTTP 200 |
| BFF via proxy | http://localhost:5173/api/health | HTTP 200 |
| Sessão sem login | http://localhost:5173/api/session | {"authenticated":false} |

## 2. Configure o cliente

Edite estes campos no .env existente:

~~~dotenv
WEB_ORIGIN=http://localhost:5173
AUTH_API_URL=http://localhost:3001
AUTH_ISSUER=http://localhost:3001
CLIENT_ID=demo-web
REDIRECT_URI=http://localhost:5173/auth/callback
CHAIN_IDS=1,11155111
STORAGE_DRIVER=memory
SIGNING_KEY_FILE=.local/signing-key.json
~~~

Preserve o CLIENT_SECRET gerado no setup. Configure o mesmo segredo, com pelo menos 32 caracteres, na API e no BFF.

- WEB_ORIGIN precisa coincidir com protocolo, host e porta do frontend, sem caminho nem barra final. localhost e 127.0.0.1 são origens distintas.
- AUTH_API_URL precisa ser acessível pelo navegador e pelo BFF. O SDK chama /v1/challenges e /v1/verifications nessa URL.
- AUTH_ISSUER identifica o emissor da asserção. O BFF verifica igualdade com esse valor.
- REDIRECT_URI precisa pertencer a WEB_ORIGIN e coincidir com a URI registrada na API. Neste protocolo, ela vincula o desafio e a troca de código. O SDK conclui por JSON e não navega para /auth/callback. O frontend escolhe a página pós-login.
- CLIENT_ID e CHAIN_IDS precisam coincidir nos dois backends.

O executável carrega um cliente por ambiente. Para integração programática com mais clientes, buildAuthApp aceita clients: [...] em [auth-api/src/app.ts](../apps/auth-api/src/app.ts).

Mantenha CLIENT_SECRET, DATABASE_URL e o arquivo da chave privada no servidor. Não exponha esses dados com prefixo VITE_. Reinicie os backends ao editar o ambiente.

## 3. Importe o SDK e configure o proxy

O frontend do monorepo já declara "@tcc/browser-sdk": "*"; npm ci na raiz vincula o workspace.

Para um frontend separado, mantenha o repositório Âncora ao lado da pasta desse app e rode na raiz do frontend:

~~~shell
npm install "../tcc-decentralized-auth/core/packages/browser-sdk"
~~~

Adapte o caminho à sua estrutura. O pacote é privado e exporta fontes TypeScript; use um bundler compatível, como o Vite do exemplo. Não há pacote publicado para instalar por nome no registro npm.

Na raiz do Âncora, use npm run dev:api e npm run dev:bff em terminais separados. No frontend, adicione este trecho a server em defineConfig no vite.config.ts:

~~~typescript
server: {
  port: 5173,
  strictPort: true,
  proxy: {
    '/api': 'http://127.0.0.1:3002',
  },
},
~~~

O SDK usa rotas relativas e credentials: 'same-origin'. Preserve o header Origin no proxy. As mutações do BFF exigem Origin igual a WEB_ORIGIN e Content-Type: application/json.

Confirme que /api/session retorna JSON pela origem do frontend. Se retornar o HTML da SPA, corrija o encaminhamento de /api/*.

## 4. Implemente o login

Use [WalletLogin.tsx](../../docs/examples/WalletLogin.tsx) como componente da rota pública /. O exemplo inclui:

- descoberta de carteiras e limpeza do listener ao desmontar;
- seleção de provider, consentimento e bloqueio durante o login;
- restauração de sessão, progresso e tratamento de erros;
- navegação para /arearestrita após authenticated: true.

A chamada principal é:

~~~typescript
import { signIn } from '@tcc/browser-sdk';

// No handler de clique, após seleção da carteira e consentimento:
const session = await signIn({
  provider: selected.provider,
  onStep: setStep,
});
if (session.authenticated) window.location.assign('/arearestrita');
~~~

selected e setStep pertencem ao componente completo do exemplo. O SDK usa os estados connecting, challenge, signing, verifying e session. discoverWallets procura providers EIP-6963 e usa window.ethereum como fallback. Outro conector pode fornecer um provider EIP-1193 a signIn; esta versão não inclui WalletConnect pronto.

Uma mudança de conta, rede ou desconexão durante o login cancela a tentativa. Depois de criar a sessão, trocar a seleção na extensão não encerra a sessão do app. Use logout().

## 5. Proteja dados, restaure a sessão e encerre o acesso

Monte [RestrictedArea.tsx](../../docs/examples/RestrictedArea.tsx) em /arearestrita. O componente usa getSession(), getPrivateResource() e logout(), com tratamento de falha e redirecionamento. Para um app sem roteador, coloque os dois componentes ao lado do [App.tsx de integração](../../docs/examples/App.tsx) e importe seu export default no main.tsx. Os exemplos navegam com recarga completa. Se o app já usa roteador, registre os componentes nele. Consulte o [App.tsx da demonstração](../../frontend/demo-web/src/App.tsx) para a navegação existente.

A resposta de sessão tem esta forma; os valores abaixo são ilustrativos:

~~~json
{
  "authenticated": true,
  "user": {
    "accountId": "eip155:11155111:0x1111111111111111111111111111111111111111",
    "address": "0x1111111111111111111111111111111111111111",
    "chainId": 11155111
  },
  "expiresAt": "2026-09-23T15:30:00.000Z"
}
~~~

A sessão usa cookie HttpOnly, sem token no localStorage. Para vincular um usuário no seu banco, use o accountId validado no backend. A conta na rede 1 e a mesma conta na rede 11155111 têm identificadores distintos. Autenticação por carteira não atribui permissões administrativas nem comprova identidade civil.

**Verifique a sessão em cada endpoint privado do backend.** O redirecionamento no React cuida da navegação. GET /api/private verifica o cookie e responde 401 sem sessão. Ao criar outra rota dentro de buildBffApp, use a função local readSession de [demo-bff/src/app.ts](../apps/demo-bff/src/app.ts) como referência e aplique suas regras de autorização. readSession não é exportada.

No desenvolvimento via Vite, o cliente verifica a página e o BFF protege a API. Ao servir o build pelo BFF, GET /arearestrita também verifica a sessão no servidor e redireciona para / sem cookie válido. O build exige npm run build.

A sessão dura até 30 minutos sem atividade ou oito horas desde sua criação. logout() revoga a sessão e limpa os cookies. Apenas ocultar a interface não encerra o acesso.

## 6. Valide e trate erros

Roteiro no seu app:

1. Sem login, confirme authenticated: false em /api/session e 401 em /api/private.
2. Faça login com conta EOA e confira user.accountId, a área restrita e o recurso privado com status 200.
3. Recarregue a página e confira a manutenção da sessão.
4. Faça logout e confira o redirecionamento e nova resposta 401 no recurso privado.
5. Recuse uma assinatura e troque a rede em outra tentativa. A interface deve mostrar o erro e permitir um novo fluxo.

Verificações do repositório Âncora:

~~~shell
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
~~~

Essas suítes verificam o protótipo. Adicione o roteiro à suíte da sua aplicação. Sem TEST_DATABASE_URL, os testes PostgreSQL são ignorados. Use uma base de testes isolada, com permissão de criar e remover schemas; veja [storage/README.md](../packages/storage/README.md).

| Erro | Verificação |
| --- | --- |
| ORIGIN_REJECTED / ORIGIN_NOT_ALLOWED | Confira WEB_ORIGIN, REDIRECT_URI e preservação de Origin no proxy. |
| JSON_REQUIRED / resposta HTML | Envie JSON e confira o proxy de /api/*. |
| unsupported_chain / CHAIN_NOT_ALLOWED | Compare a rede selecionada com CHAIN_IDS nos dois servidores. |
| user_rejected | Permita tentar de novo após a recusa. |
| wallet_pending | Peça para concluir ou cancelar a solicitação aberta na extensão. |
| wallet_changed / INVALID_FLOW | Inicie outro fluxo após mudança, expiração ou reinício do BFF em memória. |
| EXCHANGE_FAILED / AUTH_UNAVAILABLE | Confira disponibilidade da API, segredo, URI e validade do código. |
| INVALID_ASSERTION | Confira AUTH_ISSUER, CLIENT_ID, relógio e acesso ao JWKS. |
| UNAUTHENTICATED | Confira cookie, expiração e reinício do BFF; solicite novo login. |
| Cannot find module @rollup/… | Confira a dependência nativa da plataforma. O lockfile desta versão veio do Windows; o workflow de CI inclui uma etapa para Linux. |

Erros HTTP usam { "error": { "code": "...", "message": "..." } }. O SDK expõe AuthenticationError.code e message. Evite registrar segredos, códigos, assinaturas, cookies e asserções.

## 7. Prepare a hospedagem

- Configure HTTPS para as origens públicas. Sirva o frontend e /api/* na mesma origem; preserve o header Origin.
- Mantenha AUTH_API_URL alcançável pelo navegador e pelo BFF. Registre origens e URIs exatas.
- Em NODE_ENV=production, o executável da API exige PostgreSQL e URLs HTTPS. Configure STORAGE_DRIVER=postgres, DATABASE_URL e aplique npm run db:migrate.
- O PostgreSQL persiste desafios e códigos da API. O BFF continua com sessões e fluxos em memória. Antes de distribuir instâncias, implemente BffStore persistente, incluindo o controle de reutilização de asserções.
- Mantenha a chave ES256 no servidor e planeje rotação de chaves e limites compartilhados antes de escalar.

Depois de configurar o ambiente e o banco:

~~~shell
npm run db:migrate
npm run build

# Execute em processos ou terminais separados:
npm run start:api
npm run start:bff
~~~

O BFF serve frontend/demo-web/dist. Configure WEB_DIST_DIR para usar o build de outro frontend. Ele atende /arearestrita com verificação de sessão e usa HttpOnly, SameSite=Strict e Secure em HTTPS.

Esta etapa descreve a adaptação do protótipo, não uma implantação pronta para produção. Consulte a [decisão de arquitetura](adr/001-siwe-eoa-bff.md) e o [modelo de ameaças](threat-model.md).

## Contrato HTTP de referência

| Operação | Entrada | Saída de sucesso |
| --- | --- | --- |
| POST /api/auth/start (BFF) | {} | flowId, codeChallenge, clientId, authApiUrl, redirectUri, chainIds e cookie de fluxo |
| POST /v1/challenges (API) | clientId, address, chainId, redirectUri, codeChallenge | HTTP 201: challengeId, message, expiresAt |
| POST /v1/verifications (API) | challengeId, message, signature | code, expiresIn |
| POST /api/auth/complete (BFF) | flowId, code e cookie de fluxo | authenticated: true, user, expiresAt e cookie de sessão |
| POST /v1/exchanges (API, só servidor) | clientId, clientSecret, code, codeVerifier, redirectUri | assertion, expiresIn |
| GET /api/session (BFF) | Cookie, sem corpo | authenticated: false ou sessão com user e expiresAt |
| GET /api/private (BFF) | Cookie, sem corpo | message, accountId; 401 sem sessão |
| POST /api/auth/logout (BFF) | {} e cookies atuais | authenticated: false |
| GET /arearestrita (BFF com build) | Cookie | Página ou redirecionamento para / |
| GET /health/live (API) | Sem corpo | Estado do processo |
| GET /health/ready (API) | Sem corpo | Estado do armazenamento; 503 se indisponível |
| GET /api/health (BFF) | Sem corpo | Estado do BFF |
| GET /.well-known/jwks.json (API) | Sem corpo | Chave pública de verificação |
| GET /openapi.json (API) | Sem corpo | Schemas da API; não inclui as rotas do BFF |

A API exige a origem cadastrada em /v1/challenges e /v1/verifications. /v1/exchanges rejeita requisições com Origin e exige segredo e codeVerifier do servidor. Headers de origem não substituem a prova criptográfica.

Desafios e fluxos duram cinco minutos; códigos e asserções duram 60 segundos. Após consumo ou expiração, inicie outro fluxo. A assinatura da carteira não funciona como token de sessão.
