# Âncora · alternativa OIDC

Implementação separada para comparar com o TCC II original. Os serviços desta pasta não usam o código em execução, as credenciais ou o banco do projeto anterior. Não inclui plugins de plataformas.

## Iniciar no Windows

Requisito: Node.js 22.13 ou superior. Nesta entrega, os testes usam Node.js 22 e Microsoft Edge. O módulo SQLite do Node 22 ainda emite um aviso experimental.

Abra `INICIAR.cmd` nesta pasta. Ou use PowerShell:

```powershell
npm ci
npm run setup
npm run build
npm start
```

| Serviço | Endereço local |
| --- | --- |
| Login hospedado Âncora | http://localhost:4200 |
| Portal do desenvolvedor | http://localhost:4200/portal |
| Site A: Biblioteca | http://localhost:4201 |
| Site B: Observatório | http://localhost:4202 |
| Descoberta OIDC | http://localhost:4200/.well-known/openid-configuration |

Use **localhost** nos três endereços. Não troque por `127.0.0.1` durante o login: as origens e os endereços de retorno precisam coincidir com o cadastro.

## Testar com uma carteira

1. Abra a Biblioteca e clique em **Entrar com Âncora**.
2. Confira o endereço do provedor e o site de destino.
3. Escolha uma extensão de carteira EVM, conecte e assine a mensagem. Selecione Ethereum ou Sepolia na carteira. Você não precisa ter saldo.
4. Autorize o compartilhamento do identificador, endereço e rede. O navegador retorna a `/arearestrita` da Biblioteca.
5. Abra o Observatório no mesmo navegador e entre. O Âncora solicita consentimento para o segundo site, sem exigir outra assinatura enquanto a sessão SSO estiver ativa.
6. Saia apenas do Observatório. A Biblioteca continua autenticada. Uma janela anônima não consegue abrir os recursos protegidos.

O navegador descobre extensões via EIP-6963, com fallback para `window.ethereum`. Esta versão não inclui WalletConnect/QR, carteiras de contrato (ERC-1271), passkeys ou carteiras embutidas. Os testes simulam a interface de uma extensão, mas o servidor valida assinaturas criptográficas reais de chaves descartáveis.

## Organização

```text
core/
  apps/provider/           Provedor OIDC, SIWE e API do portal
  apps/demo/               Backend dos sites e vínculo de usuários locais
  packages/node-sdk/       Biblioteca Node.js @ancora/node
frontend/
  hosted-login/            Login e consentimento do Âncora
  portal/                  Site público, cadastro e gestão de aplicações
  demo/                    Interfaces públicas e área restrita dos sites
  shared/                  CSS e logo
docs/                      Integração, arquitetura e operação
scripts/                   Configuração e execução local
tests/                     Persistência, segurança e navegador
.local/                    Chaves, credenciais e bancos locais (ignorado pelo Git)
```

O backend entrega `/arearestrita` apenas após validar a sessão. Ele também protege `/api/private`; esconder uma página no frontend não substitui essa verificação.

## Portal e vínculo com o usuário do site

Abra o portal, entre com sua carteira e clique em **Nova aplicação**. Cadastre nome, origem, callback e retorno de logout. O cadastro funciona imediatamente, sem terminal nem reinício. Guarde o segredo mostrado uma única vez; o painel permite editar a aplicação, gerar outro segredo e desativar novos logins. Cada carteira vê apenas seus cadastros.

A biblioteca executa `onLogin(identity)` no backend depois de validar OIDC. Ela recebe `issuer`, `sub`, `address` e `chainId`. Sua função cria ou encontra o usuário do seu banco e retorna `{ userId }`, disponível na sessão local. As demos já fazem esse vínculo com SQLite e mostram o ID local ao lado da carteira. Outro login da mesma identidade reutiliza o usuário; cada site mantém seu próprio banco.

`afterLogin` define a página de destino. `/arearestrita` é apenas o exemplo das demos, não uma rota obrigatória. O portal gera instruções e oferece um servidor Node completo para download. Consulte [o passo a passo](docs/INTEGRACAO.md).

## O que mudou

| Integração anterior | Esta alternativa |
| --- | --- |
| Carteira conectada dentro do site integrado | Carteira conectada no domínio do Âncora |
| Protocolo próprio de desafio/verificação/troca | Authorization Code com PKCE S256 e OIDC |
| Interface de carteira em cada site | Botão ou link para `/auth/login` |
| Fluxo conduzido pelo SDK do navegador | Biblioteca Node conduz o fluxo OIDC e a sessão local |
| Cada integração realiza seu login | Sessão SSO do provedor e consentimento por aplicação |

O projeto continua dependendo do servidor Âncora para verificar logins e emitir identidades. A carteira mantém a chave privada. Isso combina identidade baseada em carteira com autenticação federada; não elimina a dependência de um provedor.

## Documentação

- [Integração de um terceiro site](docs/INTEGRACAO.md)
- [Arquitetura, endpoints e modelo de segurança](docs/ARQUITETURA.md)
- [Operação e limitações antes de produção](docs/OPERACAO.md)
- [Biblioteca Node.js](core/packages/node-sdk/README.md)
- [Resultado da verificação](docs/VERIFICACAO.md)

## Verificações

```powershell
npm run build
npm test
npm run test:e2e
```

Os testes de navegador iniciam serviços isolados nas portas 4400, 4401 e 4402, com novas chaves e bancos temporários. Fecham esses serviços ao concluir. O Playwright usa Edge por padrão; em sistemas sem Edge, ajuste `channel` em `playwright.config.ts` e instale o navegador escolhido. Os relatórios ficam em `playwright-report/` e as capturas em `test-results/`.

O uso de uma biblioteca OIDC certificada não certifica esta implantação. Nenhuma suíte oficial de conformidade OIDC foi executada nesta entrega.
