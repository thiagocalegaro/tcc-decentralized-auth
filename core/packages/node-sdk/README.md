# @ancora/node

Biblioteca Node.js da alternativa OIDC do Âncora. Distribuição local de protótipo, não publicada no npm. Requer Node 22.13+ e backend confiável.

```js
import { createAncoraClient } from '@ancora/node';
const auth = await createAncoraClient({
  issuer: process.env.ANCORA_ISSUER,
  clientId: process.env.ANCORA_CLIENT_ID,
  clientSecret: process.env.ANCORA_CLIENT_SECRET,
  appUrl: process.env.APP_URL,
  database: './private/sessions.sqlite',
  afterLogin: '/minha-conta',
  afterLogout: '/',
  onLogin: async identity => {
    // Implemente com chave única (issuer, sub) no banco do site.
    const user = await findOrCreateUser(identity);
    return { userId: user.id };
  },
});
```

Cadastre a aplicação em `<issuer>/portal`. O segredo aparece uma única vez; mantenha-o no backend.

- `await auth.handle(req, res)`: atende autenticação e sessão, retorna true se respondeu; chame antes do roteamento do site.
- `auth.session(req)`: retorna issuer, sub, address, chainId, expiresAt e userId opcional, ou undefined. Use no servidor para proteger páginas e APIs.
- `auth.close()`: fecha banco e timer no encerramento.

## Contrato de onLogin

Recebe identidade verificada e imutável `{ issuer, sub, address, chainId }`, além de `{ request }` no segundo argumento. Executa antes de emitir a nova sessão. Aceita retorno síncrono ou assíncrono, `{ userId: string }` (1–200 caracteres) ou void. Exceções interrompem o login sem uma nova sessão; não revogam sessões anteriores.

Faça vínculo idempotente com chave única (issuer, sub). Não confie em IDs de usuário fornecidos pelo navegador. A função não faz transação distribuída com seu banco. Não associe automaticamente contas preexistentes sem prova de acesso a elas.

## Rotas e destinos

GET `/auth/login`, GET `/auth/callback`, GET `/api/session`, POST `/auth/logout`, POST `/auth/logout-provider`. Use `?reauth=1` no login para exigir nova assinatura.

- `afterLogin` e `afterLogout` têm padrão `/`.
- `authBasePath` tem padrão `/auth`.
- `sessionPath` tem padrão `/api/session`.
- Caminhos devem ser absolutos e locais, sem query, fragmento ou caracteres codificados.

**Mudança nesta edição:** /arearestrita deixou de ser o destino implícito. Defina `afterLogin: '/arearestrita'` se quiser manter esse comportamento.

Cadastre o callback resultante e o destino de logout no portal. HTTP exige `allowInsecureLocalhost: true` e funciona apenas em loopback fora de produção. Não importe o pacote no frontend.

A sessão SQLite expira em 30 minutos de inatividade ou 8 horas absolutas. Logout global não encerra todas as sessões locais. Cookies não separam portas do mesmo host; use domínios HTTPS próprios ao publicar.
