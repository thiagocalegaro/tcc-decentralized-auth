# Integrar um site ao Âncora

O cadastro é feito no portal. A aplicação ainda precisa de um backend para proteger o segredo, receber o callback e criar sua sessão. Esta entrega oferece uma biblioteca Node.js 22.13+; clientes OIDC em outras linguagens também podem usar o provedor. Não há plugins de plataformas.

## 1. Cadastrar pelo portal

1. Abra `<issuer>/portal` e entre com sua carteira EVM. Localmente, o endereço é http://localhost:4200/portal; na VPS, use seu domínio HTTPS.
2. Clique em **Nova aplicação** e informe nome e origem do site, por exemplo `http://localhost:4300`.
3. Mantenha `/auth/callback` e `/` como caminhos de callback e retorno de logout, respectivamente.
4. Guarde o **client secret** mostrado uma única vez. O **client ID** permanece disponível no painel.
5. Copie a configuração do painel para o ambiente privado do backend.

O cadastro entra em vigor imediatamente. Não exige comando nem reinício do Âncora. Cada carteira administra apenas suas aplicações. Não há recuperação de acesso se perder a carteira.

No provedor hospedado com NODE_ENV=production, as aplicações cadastradas precisam usar HTTPS, inclusive para testes. HTTP loopback é aceito pelo cadastro apenas no ambiente de desenvolvimento. Retornos são exatos, da mesma origem cadastrada, sem curingas. O protótipo não verifica propriedade do domínio. Nome de aplicação não é um selo de confiança; confira sempre o domínio na tela de consentimento.

## 2. Instalar a biblioteca local

Na pasta desta alternativa, gere o pacote atualizado:

```powershell
npm run pack:sdk
```

Na pasta do seu site:

```powershell
npm install "/caminho/para/ancora/.local/ancora-node-0.1.0.tgz"
```

O pacote `@ancora/node` ainda não está publicado no npm. Se instalou uma edição anterior, instale o arquivo recém-gerado novamente.

## 3. Configurar o ambiente do backend

Crie um arquivo `.env` privado com os valores do painel:

```dotenv
ANCORA_ISSUER=http://localhost:4200
ANCORA_CLIENT_ID=app_ID_GERADO_NO_PORTAL
ANCORA_CLIENT_SECRET=SEGREDO_MOSTRADO_APENAS_UMA_VEZ
APP_URL=http://localhost:4300
```

Adicione `.env` e `private/` ao `.gitignore`. Não use prefixos de variáveis públicas do frontend, como `VITE_` ou `NEXT_PUBLIC_`, para o segredo. Não salve tokens nem o segredo em localStorage.

Para experimentar sem implementar um banco do zero, baixe o **exemplo completo** no painel ou copie [exemplo-node.mjs](exemplo-node.mjs) para `server.mjs` na pasta do site:

```powershell
node --env-file=.env server.mjs
```

Esse exemplo funciona com os caminhos padrão do cadastro. Ele cria tabelas SQLite privadas, vincula a identidade a um UUID local e protege `/minha-conta` e `/api/private`. O launcher serve somente HTTP loopback; publicação exige HTTPS, limites de requisição e a revisão de [operação](OPERACAO.md).

## 4. Usar a função pós-login no seu backend

```js
import { createAncoraClient } from '@ancora/node';

const auth = await createAncoraClient({
  issuer: process.env.ANCORA_ISSUER,
  clientId: process.env.ANCORA_CLIENT_ID,
  clientSecret: process.env.ANCORA_CLIENT_SECRET,
  appUrl: process.env.APP_URL,
  database: './private/sessions.sqlite',
  allowInsecureLocalhost: true, // Apenas desenvolvimento loopback.
  afterLogin: '/minha-conta',
  afterLogout: '/',
  onLogin: async identity => {
    // Implemente no banco da SUA aplicação; exemplo completo no arquivo acima.
    const user = await findOrCreateUser({
      issuer: identity.issuer,
      sub: identity.sub,
      address: identity.address,
      chainId: identity.chainId,
    });
    return { userId: user.id };
  },
});
```

`onLogin` é executada **no servidor**, depois da validação de ID Token e UserInfo, antes de emitir a nova sessão. Ela pode ser assíncrona. O primeiro argumento é uma identidade imutável; o segundo é `{ request }`, caso o backend precise do contexto HTTP. Esse contexto não torna confiáveis IDs fornecidos pelo navegador.

Use uma restrição única em **(issuer, sub)** e uma operação idempotente: outro login da mesma identidade deve retornar o mesmo usuário. A função pode retornar `{ userId: string }` (1–200 caracteres), retornar nada ou lançar um erro. Um erro interrompe o login sem criar uma nova sessão; uma sessão anterior não é revogada automaticamente. Ela não é uma transação distribuída: o vínculo pode ter sido salvo mesmo se o navegador não completar o retorno. Por isso, deve poder ser repetida com segurança.

Não vincule automaticamente uma carteira a uma conta existente só porque o navegador informou um ID ou e-mail. Para adicionar uma carteira a uma conta preexistente, exija autenticação dessa conta e confirmação explícita. O exemplo cria/encontra contas por identidade OIDC; não implementa associação de contas já existentes.

### O que chega ao site?

```js
{
  issuer: 'http://localhost:4200',
  sub: 'eip155:1:0x...',
  address: '0x...',
  chainId: 1,
  userId: 'uuid-criado-no-banco-do-site', // Retornado por onLogin.
  expiresAt: 1790000000000              // Validade da sessão local em ms.
}
```

`issuer`, `sub`, carteira e rede vêm da identidade validada. `userId` pertence ao site. O endereço não fornece nome, e-mail, saldo ou permissões. A autorização dos recursos continua sendo responsabilidade da aplicação. Chave privada e seed phrase nunca são enviadas ao site ou ao Âncora.

Nesta versão, a mesma carteira em redes diferentes tem `sub` diferente. Nome, e-mail, recuperação de conta e unificação entre redes não são implementados.

### Callback e área restrita não são a mesma coisa

- `/auth/callback`: rota técnica da biblioteca; recebe o código e valida a autenticação.
- `onLogin`: função interna do backend; cria/encontra o usuário local.
- `afterLogin`: destino local após o sucesso, por exemplo `/minha-conta`.
- `/arearestrita`: exemplo de destino escolhido pela aplicação; não é exigido pelo Âncora.

O padrão de `afterLogin` agora é `/`. Projetos que dependiam do antigo retorno implícito devem configurar `afterLogin: '/arearestrita'`. Não existe parâmetro de URL para escolher livremente um destino externo.

## 5. Encaminhar as rotas e proteger o conteúdo

Exemplo com uma aplicação Express já criada:

```js
app.use(async (req, res, next) => {
  if (!await auth.handle(req, res)) next();
});

app.get('/minha-conta', (req, res) => {
  const user = auth.session(req);
  if (!user) return res.redirect(303, '/');
  res.json({ userId: user.userId, address: user.address });
});

app.get('/api/private', (req, res) => {
  const user = auth.session(req);
  if (!user) return res.status(401).json({ error: 'Autenticação necessária.' });
  res.json({ user });
});
```

Feche `auth.close()` quando encerrar o servidor. O arquivo `docs/exemplo-node.mjs` mostra um vínculo persistente com SQLite.

Um link basta no frontend:

```html
<a href="/auth/login">Entrar com Âncora</a>
```

Não importe a biblioteca Node no navegador. Ela gerencia descoberta OIDC, state, nonce, PKCE, troca de código, validação criptográfica e sessão HttpOnly. A aplicação continua responsável pela proteção CSRF de suas próprias escritas.

## Rotas e opções da biblioteca

| Método | Rota padrão | Função |
| --- | --- | --- |
| GET | `/auth/login` | Inicia o login |
| GET | `/auth/login?reauth=1` | Exige nova assinatura |
| GET | `/auth/callback` | Valida identidade, chama onLogin e retorna a afterLogin |
| GET | `/api/session` | Estado público da sessão, sem tokens |
| POST | `/auth/logout` | Encerra a sessão local e retorna a afterLogout |
| POST | `/auth/logout-provider` | Encerra sessão local e abre confirmação de saída do Âncora |

`authBasePath` altera o prefixo `/auth`; `sessionPath` altera `/api/session`. Se cadastrar `/login/callback`, use `authBasePath: '/login'` e link `/login/login`. O painel gera a configuração correspondente. O exemplo completo para download usa os caminhos padrão; adapte-o se mudar o cadastro.

Todos os caminhos são locais, sem consulta, fragmento, ponto, barra invertida ou caracteres codificados. `afterLogout` deve coincidir com o retorno cadastrado e apontar para página pública. A biblioteca aceita um login pendente por aplicação e navegador; outro login substitui o vínculo anterior.

POSTs de logout exigem `Origin` igual à origem do site. Inclua a origem exata do Âncora em `form-action` da CSP, junto com `'self'`. Use `Referrer-Policy: same-origin` nas páginas com formulários; o callback já usa `no-referrer`.

## Manutenção pelo portal

- **Editar:** altera nome, origem e retornos imediatamente. Atualize o backend do site se mudar sua URL.
- **Gerar novo segredo:** invalida o anterior imediatamente, sem período de sobreposição. Guarde o novo e atualize o backend; se ele carrega credenciais na inicialização, reinicie-o.
- **Desativar:** bloqueia novas autorizações e trocas de código. Não encerra sessões locais já abertas nem promete revogar todos os tokens emitidos.
- **Reativar:** permite novos logins usando a configuração atual.
- **Sair do portal:** remove somente sua sessão local no portal, preservando a sessão SSO do Âncora.

Os segredos não reaparecem ao consultar ou listar aplicações. O cadastro tem limite de 25 aplicações por desenvolvedor; não há exclusão, equipes, recuperação de carteira ou transferência de titularidade nesta entrega.

## Outros clientes OIDC

Configure `issuer`, `client_id`, `client_secret`, `scope=openid wallet`, `response_type=code`, PKCE S256 e callback exato. Descubra os endpoints pelo documento de descoberta. Os atributos `wallet_address` e `chain_id` vêm de `/userinfo`; valide ID Token e correspondência de `sub` usando uma biblioteca OIDC mantida.

Não solicite `email`, `offline_access` ou refresh tokens. Bibliotecas que exigem e-mail para criar contas precisam de adaptação. A função `onLogin` pertence ao SDK Node; outras bibliotecas implementam o vínculo no próprio callback de sucesso.
