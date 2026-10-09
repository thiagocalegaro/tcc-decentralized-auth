# Âncora

Provedor de autenticação por carteira EVM com OpenID Connect (OIDC). O usuário assina uma mensagem SIWE; o Âncora verifica a assinatura e entrega uma identidade ao backend da aplicação por Authorization Code com PKCE. A assinatura não envia transações nem exige saldo.

Este repositório inclui o serviço Âncora, suas telas de login e consentimento, o portal do desenvolvedor e o SDK Node.js. As aplicações de demonstração são mantidas apenas localmente e não são necessárias para executar o provedor.

## Executar localmente

Requer Node.js 22.13 ou superior e npm.

```sh
npm ci
npm run setup
npm run build
npm start
```

Abra http://localhost:4200/portal. No Windows, também pode usar `INICIAR.cmd`. O serviço inicia somente o Âncora. A configuração nova não cria aplicações de demonstração: entre no portal para cadastrar suas aplicações.

`npm run setup` gera as chaves e configurações em `.local/`. Reexecutá-lo preserva as chaves existentes. Os bancos SQLite de sessões, aplicações e desenvolvedores ficam no mesmo diretório, que é ignorado pelo Git.

## Hospedar em uma VPS

A implantação usa Node.js como serviço systemd, Caddy para HTTPS e SQLite no disco persistente da VPS. O Node escuta apenas em `127.0.0.1`; somente o Caddy recebe conexões públicas.

O [guia de implantação](docs/DEPLOY.md) inclui configuração do domínio, instalação, atualização, backup e verificação. Os modelos estão em `deploy/`. Use uma única instância do serviço com seu diretório de dados persistente.

## Estrutura

```text
core/apps/provider/          Provedor OIDC, SIWE e API do portal
core/packages/node-sdk/      Biblioteca de servidor @ancora/node
frontend/hosted-login/       Login por carteira e consentimento
frontend/portal/             Página pública e portal do desenvolvedor
frontend/shared/             Estilos e identidade visual do Âncora
scripts/                     Configuração e inicialização do provedor
deploy/                      Modelos systemd, Caddy e variáveis de ambiente
docs/                        Integração, arquitetura e operação
tests/                       Protocolo, persistência e portal
```

## Integrar sua aplicação

1. Entre em `<issuer>/portal` com sua carteira e cadastre sua aplicação.
2. Guarde o client ID e o segredo no backend do seu site.
3. Use o [SDK Node.js](core/packages/node-sdk/README.md) ou um cliente OIDC compatível, com PKCE S256 e escopos `openid wallet`.
4. Vincule a identidade verificada ao usuário do seu banco usando uma chave única `(issuer, sub)`.

O SDK entrega `issuer`, `sub`, `address` e `chainId` à função `onLogin`. O retorno opcional `{ userId }` fica disponível na sessão local. Cada aplicação protege suas próprias páginas e APIs no servidor. Consulte o [guia de integração](docs/INTEGRACAO.md).

O pacote não está publicado no npm. `npm run pack:sdk` gera o arquivo instalável em `.local/`.

## Verificar

```sh
npm run build
npm test
npm run test:e2e
```

Os testes de navegador usam uma configuração temporária do provedor na porta 4400 e uma carteira simulada que assina mensagens reais com chaves descartáveis. O navegador padrão é Microsoft Edge. Para usar Chromium, configure `PLAYWRIGHT_CHANNEL=chromium` e instale-o com `npx playwright install chromium`.

## Documentação e limites

- [Implantação na VPS](docs/DEPLOY.md)
- [Integração e vínculo de usuários](docs/INTEGRACAO.md)
- [Arquitetura e segurança](docs/ARQUITETURA.md)
- [Operação e backups](docs/OPERACAO.md)
- [Verificação](docs/VERIFICACAO.md)

Protótipo acadêmico para testes de integração. A identidade é baseada em carteira, mas a emissão de tokens depende do servidor Âncora. A implementação cobre contas EOA; não inclui carteiras ERC-1271, WalletConnect ou recuperação de chaves. Não há certificação OIDC desta implantação nem logout global de todas as sessões dos sites.
