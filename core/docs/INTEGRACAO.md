# Integrar o protótipo em uma aplicação

O SDK desta versão opera no mesmo domínio do BFF. Copie a configuração do exemplo e adapte as rotas de sessão ao backend da sua aplicação. Os pacotes locais exportam fontes TypeScript e ainda não foram publicados em um registro.

## Interface do navegador

```typescript
import { discoverWallets, signIn, getSession, logout } from '@tcc/browser-sdk';

const stopDiscovery = discoverWallets((wallets) => {
  // Exiba nome e seletor de carteira. Só inicie signIn após clique e consentimento.
  console.log(wallets.map(({ id, name }) => ({ id, name })));
});

// Em um handler de clique, com provider selecionado pelo usuário:
// const session = await signIn({ provider, onStep: updateProgress });
const currentSession = await getSession();
// Em um handler de logout: await logout();
// Ao desmontar a interface: stopDiscovery();
```

`signIn` solicita conta/rede, cria o desafio, verifica os campos da mensagem, pede a assinatura e conclui o fluxo no BFF. O SDK dispara os estados `connecting`, `challenge`, `signing`, `verifying` e `session`. Uma mudança de conta/rede cancela a tentativa. O SDK não solicita seed phrase nem chave privada.

## Configuração de um cliente

No exemplo, `CLIENT_ID`, `CLIENT_SECRET`, `WEB_ORIGIN`, `REDIRECT_URI` e `CHAIN_IDS` configuram o mesmo cliente nos dois backends. O operador precisa cadastrar origens e URIs exatas na API. O navegador não escolhe livremente esses destinos. A versão executável carrega um cliente por ambiente; `buildAuthApp` também aceita um array para os testes e outras integrações programáticas.

As variáveis sem prefixo `VITE_` pertencem ao servidor. Em particular, `CLIENT_SECRET`, `DATABASE_URL` e o conteúdo de `SIGNING_KEY_FILE` não devem entrar no bundle Web. O código do exemplo não lê essas variáveis no frontend.

## Contrato HTTP

| Operação | Entrada JSON | Saída de sucesso |
|---|---|---|
| `POST /api/auth/start` no BFF | `{}` | `flowId`, `codeChallenge`, `clientId`, `authApiUrl`, `redirectUri`, `chainIds`, e cookie HttpOnly do fluxo |
| `POST /v1/challenges` na API | `clientId`, `address`, `chainId`, `redirectUri`, `codeChallenge` | HTTP 201: `challengeId`, `message`, `expiresAt` |
| `POST /v1/verifications` na API | `challengeId`, `message`, `signature` | `code`, `expiresIn` |
| `POST /api/auth/complete` no BFF | `flowId`, `code` | `authenticated: true`, `user`, `expiresAt`, e cookie HttpOnly de sessão |
| `POST /v1/exchanges` na API, só servidor | `clientId`, `clientSecret`, `code`, `codeVerifier`, `redirectUri` | `assertion`, `expiresIn` |
| `GET /api/session` no BFF | Sem corpo | `authenticated: false` ou sessão com `user` e `expiresAt` |
| `POST /api/auth/logout` no BFF | `{}` | `authenticated: false`, cookies removidos e sessão revogada |

As mutações do BFF exigem JSON e `Origin` igual a `WEB_ORIGIN`. A API também exige essa origem para gerar e verificar desafios. A operação `/v1/exchanges` rejeita requisições com `Origin` e exige o segredo do cliente e o verificador PKCE. Headers de origem ajudam a proteger o contexto do navegador; o servidor não os trata como substitutos da prova criptográfica ou do segredo do cliente.

Erros têm o formato `{ "error": { "code": "...", "message": "..." } }`. O cliente deve exibir a mensagem apropriada e iniciar outro fluxo após expiração ou consumo. Ele não deve reutilizar assinatura como token de sessão. Consulte também `/openapi.json` para schemas e limites das requisições.

## Expandir após esta entrega

Crie um adaptador persistente para a interface `BffStore` antes de executar várias instâncias do BFF. Para ERC-1271, separe a verificação local de EOA da consulta ao contrato e defina a política de revogação quando a carteira mudar de estado. Integração com ferramentas OAuth/OIDC exigirá um provedor compatível com esses protocolos; os endpoints atuais não anunciam essa compatibilidade.
