# TCC — Sistema de Autenticação Descentralizada Baseado em Blockchain

> Trabalho de Conclusão de Curso (TCC) — Sistemas para Internet, UFSM, 2026.
> **Autor:** Thiago Martin

## 📌 O que é este projeto

Um **SDK server-side em Node.js/TypeScript** que permite autenticar usuários em aplicações web usando carteiras Ethereum (MetaMask, Ledger, etc.) **em vez de senhas armazenadas em banco de dados**. A identidade do usuário é provada matematicamente via assinatura criptográfica ECDSA, sem nenhum segredo compartilhado entre cliente e servidor.

O projeto é composto por:
- **`sdk-server-node`** — Biblioteca reutilizável (NPM package) com toda a lógica de autenticação
- **`demo-backend-node`** — API Express de demonstração que consome o SDK

---

## 🏗️ Arquitetura

```
Usuário (MetaMask)          Backend (Express + SDK)          Blockchain (Ethereum)
       │                            │                              │
       │ GET /challenge             │                              │
       │───────────────────────────>│ Gera nonce + mensagem EIP-4361│
       │<───────────────────────────│                              │
       │                            │                              │
       │ Assina com chave privada   │                              │
       │ (ECDSA / secp256k1)        │                              │
       │                            │                              │
       │ POST /verify               │                              │
       │───────────────────────────>│ ecrecover → valida endereço  │
       │                            │ valida domínio, nonce, TTL   │
       │                            │ (opcional) Token-Gating ────>│ balanceOf()
       │                            │ Emite JWT                    │
       │<───────────────────────────│                              │
       │                            │                              │
       │ GET /profile (Bearer JWT)  │                              │
       │───────────────────────────>│ Middleware verifica JWT       │
       │<───────────────────────────│                              │
```

**Modelo de descentralização:** Web 3.0 pura — o SDK é uma biblioteca que roda dentro do servidor do desenvolvedor. Não existe servidor central intermediário. A verificação ECDSA é 100% offline (matemática pura). A blockchain só é consultada opcionalmente para Token-Gating.

---

## 📁 Estrutura de Arquivos

```
tcc-decentralized-auth/
├── package.json                      # Monorepo (npm workspaces)
├── docker-compose.yml                # Containers para API demo e testes
├── .gitignore                        # node_modules, dist, .env
│
├── sdk-server-node/                  # 📦 BIBLIOTECA REUTILIZÁVEL
│   ├── package.json                  # Metadados NPM, exports dual CJS/ESM
│   ├── tsup.config.ts                # Bundler (gera index.js + index.mjs)
│   ├── tsconfig.json                 # Config TypeScript
│   ├── LICENSE                       # MIT
│   ├── README.md                     # Documentação do SDK para desenvolvedores
│   ├── src/
│   │   ├── index.ts                  # Re-exporta todos os módulos
│   │   ├── types.ts                  # Interfaces: SiweMessage, VerificationResult
│   │   ├── nonce.ts                  # NonceStore interface, MemoryNonceStore, RedisNonceStore, RedisLikeClient
│   │   ├── verifier.ts              # SiweVerifier: parsing EIP-4361 + verificação ECDSA
│   │   └── contracts.ts             # BlockchainVerifier: Token-Gating ERC-20/ERC-721, Roles
│   ├── tests/
│   │   └── auth.test.ts             # 13 testes unitários (Vitest)
│   └── dist/                        # Build compilado (gerado por tsup)
│       ├── index.js                  #   → CommonJS (require)
│       ├── index.mjs                 #   → ESM (import)
│       ├── index.d.ts                #   → Tipos TypeScript (CJS)
│       └── index.d.mts               #   → Tipos TypeScript (ESM)
│
├── demo-backend-node/                # 🖥️ API DE DEMONSTRAÇÃO
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example                  # Template de variáveis de ambiente
│   └── src/
│       ├── index.ts                  # Express: endpoints /challenge, /verify, /profile
│       └── test-client.ts           # Simulador de carteira para testes de integração
│
└── docs/                             # 📄 DOCUMENTAÇÃO DO TCC
    ├── preparacao_banca.md           # Perguntas e respostas para a defesa
    ├── fluxo_completo.md             # Explicação técnica detalhada do fluxo
    ├── guia_integracao.md            # Guia passo a passo para desenvolvedores
    ├── analise_tcc_opcoes.md         # Análise arquitetural (Web 2.5 vs Web 3.0)
    ├── roteiro_proximos_passos.md    # Roadmap de desenvolvimento
    ├── implementation_plan.md        # Plano de implementação original
    ├── task.md                       # Checklist de tarefas concluídas
    └── walkthrough.md                # Resumo das mudanças realizadas
```

---

## 🧩 Componentes do SDK (`sdk-server-node`)

### `types.ts` — Interfaces
- **`SiweMessage`** — Mensagem de login EIP-4361 (domain, address, nonce, chainId, timestamps, etc.)
- **`VerificationResult`** — Resultado da verificação: `{ success, message?, address? }`

### `nonce.ts` — Gerenciamento de Nonces
- **`NonceStore`** (interface) — Contrato assíncrono para qualquer implementação de armazenamento
- **`MemoryNonceStore`** — Implementação em memória RAM (dev/single-server)
- **`RedisNonceStore`** — Implementação em Redis (produção/multi-server)
- **`RedisLikeClient`** (interface) — Tipagem para o client Redis (substitui `any`)
- Nonces: 16 bytes aleatórios (crypto.randomBytes), TTL configurável (default 5min), consumidos após primeira verificação

### `verifier.ts` — Verificação ECDSA + EIP-4361
- **`SiweVerifier`** — Classe principal. Valida em sequência:
  1. `ecrecover` via `ethers.verifyMessage()` — recupera endereço da assinatura
  2. Comparação de endereços (normalização EIP-55 via `getAddress()`)
  3. Validação de domínio (anti-phishing)
  4. Validação + consumo de nonce (anti-replay)
  5. Validação de expiração e `notBefore`
- **`SiweVerifier.createMessage()`** — Método estático para formatar mensagens EIP-4361
- **`parseMessage()`** — Parser de mensagem EIP-4361 (regex + line-by-line)

### `contracts.ts` — Consultas On-chain (Token-Gating)
- **`BlockchainVerifier`** — Consultas de leitura via `ethers.JsonRpcProvider`:
  - `checkERC20Balance(address, tokenContract, minBalance)` — Saldo mínimo de token
  - `checkERC721Ownership(address, nftContract)` — Posse de NFT
  - `checkRole(address, aclContract, roleHash)` — Role no padrão OpenZeppelin AccessControl

---

## ✅ O que está PRONTO

| Etapa | Status |
|-------|--------|
| Setup do workspace (monorepo npm workspaces) | ✅ |
| SDK: NonceStore (Memory + Redis, interface assíncrona) | ✅ |
| SDK: SiweVerifier (ECDSA + EIP-4361 completo) | ✅ |
| SDK: BlockchainVerifier (ERC-20, ERC-721, AccessControl) | ✅ |
| SDK: Build dual CJS/ESM via tsup | ✅ |
| SDK: 13 testes unitários (Vitest) | ✅ |
| SDK: JSDoc completo em todos os arquivos | ✅ |
| SDK: README.md, LICENSE (MIT), package.json com metadados NPM | ✅ |
| Demo: API Express com /challenge, /verify, /profile | ✅ |
| Demo: Middleware JWT para rotas protegidas | ✅ |
| Demo: CORS habilitado | ✅ |
| Demo: test-client.ts (simulador de carteira + testes de segurança) | ✅ |
| Projeto: .gitignore, .env.example, docker-compose.yml | ✅ |
| Documentação: preparação para banca, fluxo técnico, guia de integração | ✅ |

---

## ⏳ O que FALTA

| Item | Prioridade | Detalhes |
|------|:---:|---------|
| **Build do SDK precisa ser refeito** | 🔴 Alta | O último build com `tsup` funcionou, mas se houver mudanças nos fontes, rodar `cd sdk-server-node && npx tsup` |
| **Publicação real no NPM** | 🟡 Média | O package.json está pronto. Falta `npm login` + `npm publish` (ou manter local) |
| **SDK client-side (frontend)** | 🟡 Média | Não foi criado. Existe apenas o código de exemplo no `docs/guia_integracao.md` mostrando como usar `window.ethereum` / MetaMask |
| **Frontend demo funcional** | 🟡 Média | Não existe frontend. O teste é feito via `test-client.ts` (simulador em código) |
| **Análise de ameaças no artigo** | 🟢 Baixa | O conteúdo está em `docs/preparacao_banca.md` seção 6, mas precisa ser formatado para o artigo LaTeX/Word |

---

## 🚀 Como rodar

### Pré-requisitos
- **Node.js >= 18** (`node --version`)
- npm (vem com Node.js)

### Instalação
```bash
git clone https://github.com/thiago-martin/tcc-decentralized-auth.git
cd tcc-decentralized-auth
npm install
```

### Build do SDK
```bash
cd sdk-server-node
npx tsup          # Gera dist/index.js (CJS) + dist/index.mjs (ESM)
```

### Build da API Demo
```bash
cd demo-backend-node
npx tsc            # Gera dist/index.js e dist/test-client.js
```

### Rodar testes unitários (SDK)
```bash
cd sdk-server-node
npx vitest run     # 13 testes, ~300ms
```

### Rodar teste de integração (API + simulador)
```bash
cd demo-backend-node
node dist/index.js &           # Inicia o servidor na porta 3000
node dist/test-client.js       # Roda o simulador completo
```

O simulador testa:
1. ✅ Login bem-sucedido (fluxo completo challenge → sign → verify → JWT → profile)
2. ✅ Bloqueio de replay attack (mesma assinatura reutilizada)
3. ✅ Bloqueio de falsificação de identidade (assinatura válida + endereço errado)
4. ✅ Bloqueio por Token-Gating (saldo insuficiente, consulta real à Ethereum Mainnet)

### Via Docker Compose
```bash
docker-compose up demo-api             # Roda a API demo
docker-compose run --rm test           # Roda os testes
```

---

## 🔑 Variáveis de Ambiente (demo-backend-node)

Copie `.env.example` para `.env`:

```bash
PORT=3000
DOMAIN=localhost:3000
JWT_SECRET=TROQUE_POR_UMA_CHAVE_SECRETA_FORTE
RPC_URL=https://ethereum-rpc.publicnode.com
TOKEN_ADDRESS=0x514910771AF9Ca656af840dff83E8264EcF986CA
MIN_BALANCE=1.0
```

---

## 🎓 Contexto Acadêmico (importante para continuidade)

### Decisões de arquitetura tomadas:
1. **Web 3.0 pura (descentralização total)** — Escolhido em vez de Web 2.5 (API centralizada). O SDK é uma biblioteca que cada dev roda no próprio servidor, sem intermediário central.
2. **Node.js/TypeScript** — Escolhido em vez de Java/Spring. É o ecossistema mais comum na Web3.
3. **Sem frontend** — O foco é o backend/SDK. O frontend é demonstrado apenas em código de exemplo.
4. **Token-Gating como extensão** — Não é parte do núcleo de autenticação. Foi incluído para justificar a presença da blockchain (a verificação ECDSA em si é 100% offline).

### Pontos sensíveis para a banca:
- "A verificação ECDSA funciona sem blockchain" → **Verdade.** A blockchain justifica-se pelo registro de identidades descentralizado (sem CA) e pelo Token-Gating.
- "MetaMask centraliza a chave" → **Parcialmente verdade.** MetaMask é apenas uma opção. O SDK aceita qualquer assinatura ECDSA/secp256k1 (Ledger, Trust Wallet, código puro).
- Toda a preparação para banca está em `docs/preparacao_banca.md`.

### Documentos de referência em `docs/`:
| Arquivo | Conteúdo |
|---------|----------|
| `preparacao_banca.md` | 8 seções de perguntas e respostas para a defesa |
| `fluxo_completo.md` | Explicação técnica com diagramas de sequência |
| `guia_integracao.md` | Tutorial para desenvolvedores (do `npm install` ao Token-Gating) |
| `analise_tcc_opcoes.md` | Debate centralização vs descentralização |
| `roteiro_proximos_passos.md` | Roadmap original (fases 1-4) |
| `task.md` | Checklist de todas as tarefas concluídas |

---

## 📜 Licença

MIT © Thiago Martin — UFSM, 2026
