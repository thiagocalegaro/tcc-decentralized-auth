# Âncora · TCC II

Protótipo de autenticação por carteira Ethereum desenvolvido para o TCC de Thiago Augusto Calegaro Martin. Você conecta uma carteira, assina uma mensagem Sign-In with Ethereum (SIWE) e acessa uma área protegida por sessão.

Esta versão verifica contas EOA por recuperação da assinatura. O login acontece fora da blockchain e dispensa transação, saldo e taxa de rede. A chave privada fica na carteira. A API de verificação e as sessões da aplicação dependem dos servidores do projeto.

O projeto oferece uma API própria de integração, com código de uso único, PKCE S256 e cliente confidencial. Ele **não implementa um provedor OAuth 2.0 ou OpenID Connect**. Considere esta entrega um protótipo acadêmico; ainda há trabalho de operação, persistência de sessões e revisão antes de qualquer uso em produção.

## Executar no Windows

Instale Node.js 22.12 ou superior, com npm. No PowerShell:

```powershell
Set-Location -LiteralPath 'C:\Users\get10\projetos IA\TCC II'
npm ci
npm run setup
npm run dev
```

Abra **[http://localhost:5173](http://localhost:5173)**. Use esse endereço, inclusive o nome `localhost`: o servidor verifica a origem exata. Abrir `http://127.0.0.1:5173` não corresponde à configuração padrão.

`npm run setup` gera `.env`, um segredo aleatório de cliente e a chave ES256 em `.local/signing-key.json`. O script preserva arquivos existentes. O `.gitignore` exclui `.env` e `.local/`; mantenha esses arquivos fora de commits e compartilhamentos. A chave ES256 pertence à API e serve para assinar asserções de autenticação. Ela é distinta da chave da sua carteira.

O comando `npm run dev` inicia os três processos e os encerra com `Ctrl+C`. Caso precise reiniciar um backend após editar o código, encerre o comando e execute-o outra vez. Para trabalhar com observação de arquivos, use `npm run dev:api`, `npm run dev:bff` e `npm run dev:web` em terminais separados.

Em Linux ou macOS, entre na pasta do projeto com `cd '/caminho/TCC II'` e execute os mesmos comandos `npm ci`, `npm run setup` e `npm run dev`.

## Fazer o primeiro login

1. Abra a aplicação em um navegador com uma carteira Ethereum, como MetaMask, instalada e desbloqueada. Use uma conta EOA de teste.
2. Selecione Ethereum Mainnet, chain ID `1`, ou Sepolia, chain ID `11155111`. Você não precisa de fundos para assinar a mensagem.
3. Escolha a carteira detectada, leia o resumo de dados e marque o consentimento.
4. Clique em **Conectar e assinar**. Autorize a conexão e confira o domínio, a conta e a mensagem na carteira antes de assinar.
5. Na área privada, clique em **Acessar recurso protegido**. O backend exige a sessão para responder. **Encerrar sessão** revoga a sessão atual.

A interface informa quando não encontra uma carteira e explica como preparar o navegador. O produto não contém carteira de teste embutida nem chave privada pronta. Os testes automatizados usam provedores controlados dentro do ambiente de teste.

Uma troca de conta ou rede durante o login cancela a tentativa. Após criar a sessão, mudar a seleção ou desconectar a extensão não revoga a sessão da aplicação: use **Encerrar sessão**. A versão atual não oferece recuperação de conta nem carteiras de contrato ERC-1271.

## Componentes e fluxo

| Componente | Endereço de desenvolvimento | Responsabilidade |
| --- | --- | --- |
| Interface React/Vite | `http://localhost:5173` | Consentimento, carteira, assinatura e área privada; proxy `/api` para o BFF |
| API Fastify | `http://localhost:3001` | Desafios SIWE, verificação EOA, códigos e asserções ES256 |
| BFF Fastify | `http://localhost:3002` | Segredo do cliente, PKCE, validação das asserções e cookies de sessão |

```mermaid
sequenceDiagram
    participant N as Navegador + SDK
    participant C as Carteira EOA
    participant B as BFF
    participant A as API de autenticação
    N->>B: Iniciar fluxo
    B-->>N: Cookie HttpOnly + flowId + codeChallenge
    N->>C: Solicitar conta e rede
    N->>A: Solicitar desafio vinculado ao cliente e PKCE
    A-->>N: Mensagem SIWE com nonce e validade
    N->>C: Solicitar assinatura da mensagem
    C-->>N: Assinatura
    N->>A: Verificar mensagem e assinatura
    A-->>N: Código de uso único
    N->>B: Concluir fluxo com flowId e código
    B->>A: Trocar código com segredo e codeVerifier
    A-->>B: Asserção ES256
    B-->>N: Cookie de sessão HttpOnly
    N->>B: Consultar recurso protegido
```

O BFF guarda o `codeVerifier` no servidor e associa o fluxo a um cookie HttpOnly. Na conclusão, exige o cookie correspondente ao `flowId` e troca o código por uma asserção. O navegador recebe apenas a identificação da conta e um cookie de sessão opaco; o segredo do cliente e a asserção não fazem parte da resposta ao navegador.

Os desafios e fluxos duram cinco minutos. O código e a asserção duram 60 segundos. A sessão expira após 30 minutos sem atividade ou oito horas desde sua criação. A identidade usa o formato `eip155:<chainId>:<endereço-em-minúsculas>`; a mesma carteira em duas redes corresponde a duas identidades dessa aplicação.

| Consulta | URL padrão |
| --- | --- |
| API ativa | [http://localhost:3001/health/live](http://localhost:3001/health/live) |
| Persistência da API disponível | [http://localhost:3001/health/ready](http://localhost:3001/health/ready) |
| Contrato OpenAPI da API | [http://localhost:3001/openapi.json](http://localhost:3001/openapi.json) |
| Chave pública de verificação | [http://localhost:3001/.well-known/jwks.json](http://localhost:3001/.well-known/jwks.json) |
| BFF ativo, pelo proxy Web | [http://localhost:5173/api/health](http://localhost:5173/api/health) |

## Persistência e PostgreSQL

A configuração inicial usa memória, adequada a uma demonstração com um processo de cada backend. Reiniciar a API apaga seus desafios e códigos. Reiniciar o BFF invalida suas sessões e fluxos.

O adaptador PostgreSQL persiste **os desafios e códigos da API**. O BFF continua com armazenamento em memória mesmo com `STORAGE_DRIVER=postgres`; não distribua essa versão do BFF entre várias instâncias.

Com Docker e Docker Compose ativos:

```shell
docker compose -f core/infra/docker/compose.yaml up -d postgres
docker compose -f core/infra/docker/compose.yaml ps
```

Aguarde o estado saudável do serviço e edite `.env`:

```dotenv
STORAGE_DRIVER=postgres
DATABASE_URL=postgresql://tcc:tcc_local_dev@127.0.0.1:5432/tcc_auth
```

As credenciais acima pertencem ao ambiente local do Compose. Se alterar a senha do serviço, ajuste `DATABASE_URL` com o mesmo valor. Aplique as migrações e inicie a aplicação:

```shell
npm run db:migrate
npm run dev
```

O Compose vincula o PostgreSQL a `127.0.0.1:5432` e mantém os dados em volume. Para parar o banco preservando os dados, use `docker compose -f core/infra/docker/compose.yaml stop`.

Docker não estava ativo no ambiente da entrega, portanto os testes contra PostgreSQL real não foram executados localmente. O workflow em `.github/workflows/ci.yml` provisiona PostgreSQL e define `TEST_DATABASE_URL` para a suíte de integração; isso descreve a configuração do CI, não comprova uma execução remota. Consulte [a validação da entrega](core/docs/VALIDACAO.md).

## Verificação

```shell
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run build` verifica os tipos e gera a interface em `frontend/demo-web/dist`. Os testes do SDK cobrem o vínculo entre mensagem, origem, conta e rede, a assinatura dos bytes originais e o cancelamento do fluxo. Os demais testes exercitam API, sessões, armazenamento e integração. O relatório com os resultados desta entrega fica em [core/docs/VALIDACAO.md](core/docs/VALIDACAO.md).

A suíte PostgreSQL exige `TEST_DATABASE_URL` apontando para uma base dedicada a testes, com permissão de criar e remover schemas. Sem essa variável, o Vitest ignora os testes PostgreSQL. A configuração e os detalhes de isolamento estão em [core/packages/storage/README.md](core/packages/storage/README.md).

## Organização

```text
frontend/
  demo-web/       Interface React/Vite de demonstração
  tests/e2e/      Testes de navegador da interface
core/
  apps/           API de autenticação e BFF de sessões
  packages/       SDK, protocolo e armazenamento
  infra/          PostgreSQL local e migrações SQL
  docs/           Decisões, ameaças e validação técnica
scripts/          Preparação e execução coordenada
```

Leia a [decisão de arquitetura](core/docs/adr/001-siwe-eoa-bff.md) e o [modelo de ameaças](core/docs/threat-model.md) antes de ampliar o protocolo. As próximas etapas incluem sessões persistentes no BFF, suporte ERC-1271 com política de RPC e um estudo acadêmico de tempo de login, falhas e esforço de integração. Uma avaliação de produção precisa incluir rotação de chaves, HTTPS, observabilidade e limites compartilhados entre instâncias.
