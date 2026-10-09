# Arquitetura da alternativa

## Caminho do login

```text
Navegador       Backend do site          Âncora OIDC              Carteira
    | GET /auth/login  |                     |                       |
    |----------------->| guarda state,       |                       |
    |                  | nonce, PKCE         |                       |
    |<---- redirect ---|                     |                       |
    | GET /authorize ----------------------->|                       |
    |<------ login hospedado ----------------|                       |
    | conexão e pedido de assinatura ------------------------------->|
    |<--------------------- assinatura SIWE -------------------------|
    | POST /interaction/.../verify --------->| valida e consome nonce |
    |<----------- consentimento ------------|                       |
    | POST /interaction/.../confirm -------->| registra concessão     |
    |<---- redirect ao callback com code ----|                       |
    | GET /auth/callback|                     |                       |
    |----------------->| POST /token -------->|                       |
    |                  |<---- tokens --------|                       |
    |                  | valida ID Token e consulta /userinfo        |
    |                  | onLogin: encontra/cria usuário local        |
    |<--- cookie local + afterLogin ---------|                       |
```

O provedor usa `oidc-provider` 9.x. A biblioteca usa `openid-client` 6.x e habilita a checagem criptográfica do ID Token. O lockfile fixa as versões instaladas. A aplicação não implementa um emissor ou parser JWT próprio.

## Estado e vínculos

- O desafio SIWE pertence a uma interação vinculada ao cookie do provedor. Sua mensagem inclui domínio, esquema, URI, endereço, rede, nonce, validade e identificador da interação. O servidor exige a mensagem que emitiu e confere a assinatura EOA. A emissão de um novo desafio invalida o anterior dessa interação.
- O servidor consome o desafio antes da operação assíncrona de recuperação da assinatura, impedindo duas aceitações concorrentes. Uma assinatura incorreta exige um novo desafio.
- O provedor exige PKCE S256, aceita somente fluxo de código e confere o retorno contra a lista cadastrada. Códigos duram 60 segundos e têm consumo único.
- A biblioteca vincula a volta do navegador a estado guardado no servidor e a um cookie de fluxo. Valida `state`, `nonce`, emissor, audiência, validade e assinatura do ID Token com a biblioteca OIDC, além da correspondência de `sub` no UserInfo.
- As rotas de interação exigem origem exata e token CSRF. Cada aplicação tem um banco de sessões próprio. O navegador recebe um ID opaco; o banco usa seu hash para localizar a sessão.
- A sessão local expira após 30 minutos de inatividade ou 8 horas absolutas. O provedor tem TTL de sessão e concessão configurado em 8 horas. Tokens de acesso e ID Tokens têm validade de 5 minutos; não renovamos acesso por refresh token.

O identificador é `eip155:<chainId>:<endereço em minúsculas>`. Nesta versão, a mesma chave em redes diferentes resulta em identidades diferentes. Aplicações que desejam unificar essas contas precisam de uma política explícita de vinculação.

## Endpoints do provedor

| Rota | Uso |
| --- | --- |
| `/.well-known/openid-configuration` | Metadados OIDC |
| `/authorize` | Solicitação de autenticação e consentimento |
| `/token` | Troca de código no servidor |
| `/userinfo` | Identificador, endereço e rede autorizados |
| `/jwks` | Chaves públicas, sem parâmetros privados |
| `/logout` | Logout iniciado pela aplicação, com confirmação |
| `/interaction/:uid` | Tela hospedada de login/consentimento |
| `/interaction/:uid/details` | Dados da interação e token CSRF |
| `/interaction/:uid/challenge` | Emite mensagem SIWE |
| `/interaction/:uid/verify` | Valida assinatura SIWE |
| `/interaction/:uid/confirm` | Registra consentimento |
| `/interaction/:uid/abort` | Cancela a interação |

Os quatro últimos endpoints recebem POST JSON. Eles atendem somente a interface hospedada. O desenvolvedor de outro site integra os endpoints OIDC, não as rotas internas de SIWE.

## Portal de desenvolvedores e cadastro dinâmico

O site público fica em `/`; o portal, em `/portal`. O portal é um cliente OIDC confidencial interno, com callback `/portal/auth/callback`. Ele usa o mesmo login por carteira e mantém uma sessão local própria. A descoberta OIDC é carregada sob demanda, após o servidor começar a escutar.

As tabelas `developers` e `applications` ficam no banco do provedor. Desenvolvedores são identificados por `(issuer, sub)`; cada aplicação possui um proprietário. O backend deriva esse proprietário da sessão, nunca do corpo da requisição. O cliente interno do portal não pertence a uma carteira e não é editável pelo painel.

O adaptador `Client` consulta o registro persistente em cada resolução. Assim, cadastro, edição, desativação e rotação de segredo não exigem reiniciar o provedor. Clientes antigos de `provider.json` são inseridos apenas se ainda não existirem. Não há endpoint de Dynamic Client Registration OIDC aberto: o cadastro usa a API autenticada do portal.

| API do portal | Operação |
| --- | --- |
| GET `/portal/api/me` | Identidade da sessão, emissor e token CSRF |
| GET/POST `/portal/api/applications` | Lista aplicações próprias / cria aplicação |
| GET/PATCH `/portal/api/applications/:id` | Consulta / atualiza aplicação própria |
| POST `/portal/api/applications/:id/rotate` | Troca o segredo e mostra o novo uma vez |
| POST `/portal/api/applications/:id/disable` ou `/enable` | Desativa ou reativa novos logins |
| GET `/portal/api/example` | Download autenticado de exemplo Node sem credenciais |

Escritas exigem Origin exata e token CSRF vinculado à sessão. IDs inexistentes e IDs de terceiros retornam o mesmo 404. Anônimos recebem 401. O limite é de 25 aplicações por desenvolvedor e 120 requisições por minuto por IP para rotas do portal. Segredos são omitidos das consultas, mas persistem em disco privado: isso não equivale a criptografia em repouso.

## Vínculo com a conta da aplicação

O SDK chama `onLogin` depois de validar tokens e UserInfo e antes de criar a sessão local. A identidade inclui emissor, identificador, endereço e rede; a função devolve um `userId` do banco da aplicação. Falha no vínculo impede uma nova sessão. `afterLogin` permite escolher uma página local fixa; o padrão é `/`.

## SSO e logout

Cada aplicação possui um cliente OIDC distinto. Ao entrar em outra aplicação, uma sessão ativa no Âncora dispensa nova assinatura, mas o usuário ainda autoriza a nova aplicação. Concessões já registradas podem dispensar outra tela de consentimento. `prompt=login` exige nova assinatura.

O logout local não apaga a sessão SSO. O logout do provedor encerra a sessão do Âncora e a sessão da aplicação que iniciou a saída. Esta versão não implementa back-channel logout para encerrar cookies locais de todos os sites.

## Fontes do protocolo

- [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html)
- [OpenID Connect Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html)
- [PKCE, RFC 7636](https://www.rfc-editor.org/rfc/rfc7636.html)
- [SIWE, EIP-4361](https://eips.ethereum.org/EIPS/eip-4361)
- [oidc-provider](https://github.com/panva/node-oidc-provider)
- [openid-client](https://github.com/panva/openid-client)
