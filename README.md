# Âncora — autenticação OIDC com carteira

Protótipo acadêmico de autenticação federada com carteiras EVM. O provedor Âncora verifica uma assinatura SIWE e atua como provedor OpenID Connect (OIDC). Uma aplicação cliente usa Authorization Code com PKCE para receber a identidade e criar sua própria sessão.

Este repositório contém o backend do provedor, APIs do portal, a biblioteca Node.js, documentação e testes. **As interfaces web foram removidas**: não há frontend do login hospedado, portal visual ou telas das aplicações de demonstração neste repositório.

## O que está incluído

- `core/apps/provider/`: provedor OIDC, verificação SIWE e API de cadastro/gestão de aplicações.
- `core/apps/demo/`: backend de demonstração, proteção da área privada e vínculo da identidade com usuário local.
- `core/packages/node-sdk/`: biblioteca de servidor `@ancora/node` para login OIDC e sessão local.
- `docs/`: guias de integração, arquitetura, operação e verificação.
- `scripts/`: geração da configuração local e inicialização dos serviços de demonstração.
- `tests/`: testes de protocolo, persistência, cadastro e fluxos de navegador.
- `.local/`: dados e segredos locais gerados na primeira configuração; ignorado pelo Git.

## Estado deste checkout

O código do servidor ainda referencia arquivos estáticos em `frontend/`. Como essa pasta não está no repositório, o checkout **não inicia a experiência completa**: `npm run build` e `npm start` dependem de arquivos ausentes. A interface gráfica do portal também não está disponível, embora as rotas da API do portal permaneçam no backend.

Portanto, este repositório serve atualmente para consultar e desenvolver os componentes de backend, SDK e documentação. Para executar o fluxo ponta a ponta, é necessário fornecer/restaurar separadamente as interfaces esperadas pelo servidor ou adaptar o código para não depender delas. Os comandos abaixo são referências do projeto e não indicam que o fluxo completo esteja executável neste checkout.

## Requisitos e configuração

- Node.js 22.13 ou superior e npm.
- SQLite integrado ao Node.js; a versão 22 pode exibir aviso experimental.

Na raiz do projeto:

```powershell
npm ci
npm run setup
```

`npm run setup` cria `.local/` com chaves, credenciais e configurações próprias para o provedor e as duas aplicações de demonstração. Ele preserva a configuração existente quando executado novamente. Não publique nem compartilhe `.local/`.

O launcher previsto é `INICIAR.cmd`; no estado atual, ele também depende dos arquivos de frontend ausentes e não inicia com sucesso sem que essa dependência seja resolvida.

## Fluxo de autenticação

1. A aplicação cliente redireciona o navegador ao provedor OIDC.
2. O usuário conecta uma carteira EVM e assina uma mensagem SIWE sem executar transação ou pagar taxa de rede.
3. O Âncora valida a assinatura e solicita consentimento para compartilhar a identidade com a aplicação.
4. O provedor retorna um código de autorização. O backend do cliente o troca por tokens usando PKCE e suas credenciais confidenciais.
5. O SDK valida a resposta, chama `onLogin` no servidor para vincular a identidade ao usuário local e mantém uma sessão em SQLite.

A identidade inclui `issuer`, `sub`, `address` e `chainId`. O vínculo recomendado no banco de cada aplicação é uma chave única `(issuer, sub)`. O segredo do cliente deve permanecer no backend, nunca no frontend.

## Integração Node.js

A biblioteca está em `core/packages/node-sdk/` e ainda não está publicada no npm. O exemplo abaixo mostra a configuração principal; consulte o guia do SDK para opções, rotas e limitações:

```js
import { createAncoraClient } from '@ancora/node';

const auth = await createAncoraClient({
  issuer: process.env.ANCORA_ISSUER,
  clientId: process.env.ANCORA_CLIENT_ID,
  clientSecret: process.env.ANCORA_CLIENT_SECRET,
  appUrl: process.env.APP_URL,
  database: './private/sessions.sqlite',
  afterLogin: '/arearestrita',
  onLogin: async identity => {
    const user = await findOrCreateUser(identity); // No banco da aplicação
    return { userId: user.id };
  },
});
```

O backend deve chamar `auth.handle(req, res)` antes do roteamento do site e consultar `auth.session(req)` para proteger páginas e APIs. A rota de destino pós-login é configurável; `/arearestrita` não é imposta pelo protocolo.

O painel visual que facilitava o cadastro pelo navegador não está incluído. A API de cadastro existe no servidor, mas precisa de uma interface cliente ou de outra ferramenta de administração para ser usada.

## Segurança e limites

- A chave privada da carteira não é enviada ao Âncora; a carteira assina localmente.
- Login não envia transações, não movimenta ativos e não exige saldo.
- As sessões de aplicação são próprias de cada site; sair do provedor não encerra automaticamente todas elas.
- O projeto é um protótipo acadêmico, não uma implantação pronta para produção.
- A validação disponível cobre contas EOA. WalletConnect/QR, carteiras de contrato ERC-1271, passkeys e carteiras embutidas não estão implementados.
- Não foi executada uma suíte oficial de conformidade OIDC. Antes de uso real, são necessários revisão de segurança, HTTPS, gestão de segredos, operação multi-instância, monitoramento, política de privacidade e testes com carteiras reais.

## Documentação

- [Guia de integração](docs/INTEGRACAO.md)
- [Arquitetura, endpoints e segurança](docs/ARQUITETURA.md)
- [Operação e limitações](docs/OPERACAO.md)
- [Biblioteca Node.js](core/packages/node-sdk/README.md)
- [Exemplo de servidor Node.js](docs/exemplo-node.mjs)
- [Resultado da verificação](docs/VERIFICACAO.md)

Alguns guias descrevem telas da versão anterior. Como o frontend foi removido, siga as partes referentes ao backend e ao SDK; etapas que dependam do portal visual ou das páginas de demonstração não estão disponíveis neste checkout.

