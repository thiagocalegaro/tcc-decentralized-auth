# Fluxo Completo: Autenticação Descentralizada com Blockchain

Este documento explica **tudo** que acontece no sistema que desenvolvemos, desde a matemática por trás da criptografia até cada linha de código que é executada quando um usuário tenta fazer login.

---

## 1. O Problema que Estamos Resolvendo

No modelo tradicional de autenticação (Web2), o fluxo é:

```
Usuário digita senha → Servidor recebe senha → Servidor compara com hash no banco de dados
```

O problema: **o servidor armazena as credenciais**. Se o banco de dados for comprometido (vazamento), todas as senhas são expostas. Mesmo com hashing (bcrypt, argon2), o risco existe.

No nosso modelo (Web3), o fluxo é:

```
Usuário prova que possui uma chave privada → Servidor verifica matematicamente → Nenhuma senha é armazenada
```

A diferença fundamental: **não existe nenhum segredo compartilhado entre o cliente e o servidor**. O servidor nunca recebe, armazena ou conhece a chave privada do usuário.

---

## 2. Os Fundamentos Criptográficos

### 2.1 Par de Chaves (Chave Privada + Chave Pública)

Toda carteira Ethereum (como a MetaMask) gera um **par de chaves** usando criptografia de curvas elípticas:

- **Chave Privada**: Um número aleatório de 256 bits (64 caracteres hexadecimais). Exemplo: `0x60f0c1918f7fcd524fd31cd78cb011c43191be29f9aa8f6a9100a44967fd0259`. **Nunca sai do dispositivo do usuário.**
- **Chave Pública**: Derivada matematicamente da chave privada usando a curva **secp256k1**. Não é possível calcular a chave privada a partir da pública (problema do logaritmo discreto).
- **Endereço Ethereum**: Os últimos 20 bytes do hash Keccak-256 da chave pública. Exemplo: `0x8fAD14B3FA7aA107C391c9A5c24fCfB4EdBA5238`.

```mermaid
graph LR
    A[Chave Privada<br/>256 bits aleatórios] -->|Multiplicação na<br/>curva secp256k1| B[Chave Pública<br/>Ponto na curva elíptica]
    B -->|Keccak-256<br/>últimos 20 bytes| C[Endereço Ethereum<br/>0x8fAD14B3...]
    
    style A fill:#ff6b6b,color:#fff
    style B fill:#ffd93d,color:#000
    style C fill:#6bcb77,color:#fff
```

> **Ponto-chave para a banca:** A relação é unidirecional. Dado um endereço, é computacionalmente impossível descobrir a chave privada. Isso é o que torna a criptografia segura.

### 2.2 Assinatura Digital ECDSA

O algoritmo ECDSA (Elliptic Curve Digital Signature Algorithm) permite que alguém com a **chave privada** assine uma mensagem qualquer, produzindo uma **assinatura** que qualquer pessoa pode verificar usando apenas o **endereço público**.

O processo de assinatura:
1. A mensagem é convertida em um hash fixo de 32 bytes (Keccak-256).
2. A chave privada é combinada com o hash usando operações matemáticas na curva elíptica.
3. O resultado é uma assinatura de 65 bytes composta por três valores: `(r, s, v)`.

O processo de verificação (o que o nosso SDK faz):
1. Recebe a mensagem original e a assinatura `(r, s, v)`.
2. Usando operações inversas na curva elíptica, **recupera o ponto da chave pública** que gerou aquela assinatura.
3. Deriva o endereço Ethereum desse ponto.
4. Compara com o endereço que o cliente alega ter.

Se coincidem → **o cliente provou que possui a chave privada**, sem nunca tê-la revelado.

---

## 3. O Fluxo Completo (Passo a Passo)

O diagrama abaixo mostra todo o percurso de uma autenticação no nosso sistema:

```mermaid
sequenceDiagram
    autonumber
    actor User as Usuário (MetaMask)
    participant Frontend as App Frontend
    participant API as API Backend<br/>(Express + SDK)
    participant NonceStore as NonceStore<br/>(Memória ou Redis)
    participant Blockchain as Ethereum<br/>(via RPC)

    Note over User,Blockchain: FASE 1 — Solicitar Desafio
    Frontend->>API: GET /api/auth/challenge?address=0xABC...
    API->>API: Valida formato do endereço (checksum EIP-55)
    API->>NonceStore: generate("0xABC..."): gera nonce aleatório de 16 bytes
    NonceStore->>NonceStore: Armazena {endereço → nonce} com TTL de 5 min
    API->>API: Monta mensagem EIP-4361 (SIWE) com nonce, domínio, timestamp
    API-->>Frontend: Retorna a mensagem formatada + nonce

    Note over User,Blockchain: FASE 2 — Assinar o Desafio
    Frontend->>User: Exibe popup da MetaMask: "Assinar mensagem?"
    User->>User: Chave privada assina a mensagem (ECDSA offline)
    User-->>Frontend: Retorna assinatura hexadecimal (65 bytes)

    Note over User,Blockchain: FASE 3 — Verificar Assinatura
    Frontend->>API: POST /api/auth/verify {message, signature, address}
    API->>API: 1. ecrecover: recupera endereço público da assinatura
    API->>API: 2. Compara endereço recuperado com o declarado
    API->>API: 3. Valida domínio da mensagem (anti-phishing)
    API->>NonceStore: verify("0xABC...", nonce): verifica e consome o nonce
    NonceStore->>NonceStore: Deleta o nonce (uso único)
    API->>API: 4. Verifica expiração da mensagem

    Note over User,Blockchain: FASE 4 (Opcional) — Token-Gating
    API->>Blockchain: balanceOf(0xABC...) no contrato ERC-20
    Blockchain-->>API: Retorna saldo (ex: 0 LINK)
    API->>API: Compara saldo com mínimo exigido

    Note over User,Blockchain: FASE 5 — Emitir Sessão
    API->>API: Gera JWT com {address} e expiração de 1 hora
    API-->>Frontend: Retorna {success: true, token: "eyJ..."}
    Frontend->>Frontend: Armazena JWT no localStorage/cookie

    Note over User,Blockchain: FASE 6 — Acessar Recursos Protegidos
    Frontend->>API: GET /api/user/profile (Header: Authorization: Bearer eyJ...)
    API->>API: Middleware verifica e decodifica o JWT
    API-->>Frontend: Retorna dados protegidos
```

---

## 4. O que Acontece em Cada Arquivo do Código

### 4.1 Quando o frontend chama `GET /api/auth/challenge?address=0xABC...`

**Arquivo:** [demo-backend-node/src/index.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/demo-backend-node/src/index.ts) (endpoint na linha ~52)

1. O Express recebe a requisição e extrai o parâmetro `address`.
2. Chama `getAddress(address)` do ethers.js para normalizar o endereço no formato EIP-55 (checksum). Se o endereço for inválido, retorna erro 400.
3. Chama `nonceStore.generate(address)` → executa o código em [nonce.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/sdk-server-node/src/nonce.ts):
   - Gera 16 bytes aleatórios criptograficamente seguros via `crypto.randomBytes(16)`.
   - Converte para hexadecimal (32 caracteres). Ex: `ee6f27345a487935955e1d58470541ed`.
   - Armazena no Map/Redis associado ao endereço lowercase, com timestamp de expiração.
4. Chama `SiweVerifier.createMessage(params)` → monta a string da mensagem no formato EIP-4361:

```
localhost:3000 wants you to sign in with your Ethereum account:
0x8fAD14B3FA7aA107C391c9A5c24fCfB4EdBA5238

Assine esta mensagem para provar que você é dono da chave privada deste endereço. Sem taxas de gás.

URI: http://localhost:3000/login
Version: 1
Chain ID: 1
Nonce: ee6f27345a487935955e1d58470541ed
Issued At: 2026-06-30T17:42:17.287Z
Expiration Time: 2026-06-30T17:52:17.288Z
```

5. Retorna a mensagem e o nonce como JSON.

---

### 4.2 Quando o frontend chama `POST /api/auth/verify`

**Arquivo:** [demo-backend-node/src/index.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/demo-backend-node/src/index.ts) (endpoint na linha ~90)

O corpo da requisição contém: `{ message, signature, address }`.

1. Chama `verifier.verify(message, signature, address)` → executa o código em [verifier.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/sdk-server-node/src/verifier.ts):

   **Passo 1 — Recuperação ECDSA (`ecrecover`):**
   ```typescript
   const signerAddress = verifyMessage(messageText, signature);
   ```
   Internamente, a função `verifyMessage` do ethers.js:
   - Prefixa a mensagem com `\x19Ethereum Signed Message:\n` + tamanho (padrão EIP-191).
   - Calcula o hash Keccak-256 da mensagem prefixada.
   - Usa os valores `(r, s, v)` da assinatura para recuperar o ponto na curva secp256k1.
   - Deriva o endereço Ethereum (últimos 20 bytes do Keccak-256 da chave pública).

   **Passo 2 — Comparação de endereços:**
   ```typescript
   if (normalizedSigner !== normalizedClaimed) {
     return { success: false, message: 'A assinatura não coincide...' };
   }
   ```
   Se o endereço recuperado matematicamente não bate com o declarado → **falsificação detectada**.

   **Passo 3 — Validação do domínio (anti-phishing):**
   ```typescript
   if (parsed.domain !== this.expectedDomain) { ... }
   ```
   Se um site malicioso tentar reusar uma assinatura feita para outro domínio → **phishing bloqueado**.

   **Passo 4 — Validação do nonce (anti-replay):**
   ```typescript
   const isNonceValid = await this.nonceStore.verify(normalizedClaimed, parsed.nonce);
   ```
   O `NonceStore` busca o nonce armazenado, compara, e **deleta imediatamente**. Se alguém interceptar a assinatura e tentar reutilizá-la → **replay bloqueado** (nonce já consumido).

   **Passo 5 — Validação de expiração:**
   Verifica se `Date.now()` ultrapassou o `expirationTime` da mensagem.

2. Se todas as validações passam, o endpoint gera um JWT:
   ```typescript
   const token = jwt.sign({ address: result.address }, jwtSecret, { expiresIn: '1h' });
   ```
   O JWT é um token convencional Web2 que contém o endereço Ethereum verificado. A partir daqui, o frontend usa o JWT como em qualquer aplicação tradicional.

---

### 4.3 Quando o Token-Gating está ativado (`gated: true`)

**Arquivo:** [demo-backend-node/src/index.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/demo-backend-node/src/index.ts) (linha ~109)

Após a verificação ECDSA ser bem-sucedida, o servidor faz uma **consulta de leitura** à blockchain:

1. Chama `blockchainVerifier.checkERC20Balance(address, tokenAddress, minBalance)` → executa o código em [contracts.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/sdk-server-node/src/contracts.ts):

   ```typescript
   const contract = new Contract(tokenAddress, ERC20_ABI, this.provider);
   const balance: bigint = await contract.balanceOf(userAddress);
   ```
   
   - O `JsonRpcProvider` envia uma chamada JSON-RPC (`eth_call`) para um nó da rede Ethereum.
   - O nó executa a função `balanceOf` do Smart Contract ERC-20 e retorna o saldo bruto (em unidades mínimas, como wei).
   - O SDK converte para formato legível usando `formatUnits` (considerando os decimais do token).
   - Se o saldo for menor que o mínimo → **acesso negado por Token-Gating**.

> **Ponto importante:** Esta consulta é **somente leitura** (view function). Não gera transação, não custa gas, não altera o estado da blockchain.

---

### 4.4 Quando o frontend acessa uma rota protegida

**Arquivo:** [demo-backend-node/src/index.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/demo-backend-node/src/index.ts) (middleware `authenticateJwt`)

1. O frontend envia o header: `Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
2. O middleware extrai o token, verifica a assinatura HMAC-SHA256 com o `JWT_SECRET` do servidor.
3. Se válido, extrai o `address` do payload e o injeta na requisição.
4. O endpoint retorna os dados protegidos.

> **Nota:** O JWT é uma sessão convencional Web2. A parte descentralizada (blockchain) é usada apenas no momento do login. Após o JWT ser emitido, o sistema se comporta como qualquer API REST tradicional.

---

## 5. Mapa de Segurança

| Ameaça | O que o atacante tenta | O que o nosso código faz | Onde no código |
|--------|------------------------|--------------------------|----------------|
| **Roubo de senha** | Acessar banco de dados para obter senhas | Não existe banco de senhas. A identidade é a chave privada, que nunca sai do dispositivo. | Arquitetura inteira |
| **Replay Attack** | Interceptar a assinatura e reutilizá-la | O nonce é de uso único. Após a verificação, é deletado (`store.delete(key)`). | [nonce.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/sdk-server-node/src/nonce.ts) — método `verify()` |
| **Falsificação de identidade** | Enviar a assinatura de A dizendo ser B | O `ecrecover` reconstrói o endereço real da assinatura. Se não bater com o declarado, rejeita. | [verifier.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/sdk-server-node/src/verifier.ts) — método `verify()` |
| **Phishing** | Site falso pede assinatura para outro domínio | A mensagem EIP-4361 inclui o domínio. O servidor rejeita mensagens de domínios diferentes. | [verifier.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/sdk-server-node/src/verifier.ts) — validação de domínio |
| **Man-in-the-Middle** | Alterar a mensagem em trânsito | Qualquer bit alterado na mensagem invalida a assinatura matematicamente (hash muda). | Garantido pelo ECDSA |
| **Acesso não autorizado** | Usuário sem tokens tenta acessar sistema restrito | Token-Gating consulta saldo on-chain em tempo real. Se insuficiente, bloqueia. | [contracts.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/sdk-server-node/src/contracts.ts) — `checkERC20Balance()` |

---

## 6. Resumo Visual: Onde Cada Coisa Vive

```mermaid
graph TB
    subgraph "Navegador do Usuário"
        MetaMask[MetaMask<br/>Guarda a Chave Privada]
    end

    subgraph "SDK: sdk-server-node (Biblioteca)"
        Nonce[nonce.ts<br/>Gera e valida nonces]
        Verifier[verifier.ts<br/>Valida assinaturas ECDSA]
        Contracts[contracts.ts<br/>Consulta Smart Contracts]
    end

    subgraph "Demo: demo-backend-node (API Express)"
        Challenge[GET /challenge<br/>Gera o desafio]
        Verify[POST /verify<br/>Verifica e emite JWT]
        Profile[GET /profile<br/>Rota protegida]
    end

    subgraph "Infraestrutura Externa"
        Redis[(Redis<br/>Nonces em produção)]
        Ethereum[Ethereum RPC<br/>Blockchain]
    end

    MetaMask -->|Assinatura ECDSA| Verify
    Challenge -->|Usa| Nonce
    Verify -->|Usa| Verifier
    Verify -->|Usa| Nonce
    Verify -->|Opcional| Contracts
    Nonce -.->|Produção| Redis
    Contracts -->|eth_call| Ethereum
```

Toda a lógica criptográfica vive dentro do SDK (`sdk-server-node`). A API demo (`demo-backend-node`) é apenas um exemplo de como consumir essa biblioteca. Qualquer desenvolvedor pode instalar o SDK no projeto dele e replicar os mesmos endpoints com as regras de negócio que ele preferir.
