# @tcc-auth/sdk-server-node

> SDK server-side para **autenticação descentralizada baseada em blockchain**, desenvolvido como Trabalho de Conclusão de Curso na UFSM.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![ethers.js v6](https://img.shields.io/badge/ethers.js-v6-blue)](https://docs.ethers.org/v6/)

---

## O que é este SDK?

Este pacote resolve um problema fundamental de segurança: **senhas e credenciais não devem ser armazenadas em bancos de dados centralizados**. Em vez disso, este SDK usa a criptografia da rede Ethereum para autenticar usuários sem armazenar nenhuma senha — a prova de identidade é feita matematicamente pela **posse da chave privada** de uma carteira.

### Funcionamento resumido

```
1. Servidor gera um nonce temporal              (anti-replay)
2. Usuário assina o nonce com sua chave privada (ECDSA offline, via MetaMask)
3. Servidor verifica a assinatura matematicamente, sem banco de dados
4. (Opcional) Servidor valida posse de tokens on-chain via Smart Contracts
5. Sessão JWT convencional é emitida
```

Nenhuma senha é transmitida. Nenhuma senha é armazenada. A blockchain é a fonte de verdade.

---

## Instalação

```bash
npm install @tcc-auth/sdk-server-node
```

O SDK tem uma única dependência obrigatória (`ethers >= 6.0.0`). O suporte a Redis é **opcional** — necessário apenas se quiser armazenamento de nonces distribuído.

```bash
# Para suporte a Redis (opcional)
npm install redis
```

---

## Início Rápido

### 1. Verificação de assinatura (fluxo básico)

```typescript
import express from 'express';
import {
  MemoryNonceStore,
  SiweVerifier,
  SiweMessage
} from '@tcc-auth/sdk-server-node';

const app = express();
app.use(express.json());

const nonceStore = new MemoryNonceStore();
const verifier = new SiweVerifier('localhost:3000', nonceStore);

// Passo 1: Gerar e retornar o desafio para o cliente assinar
app.get('/auth/challenge', async (req, res) => {
  const address = req.query.address as string;

  const nonce = await nonceStore.generate(address);

  const message = SiweVerifier.createMessage({
    domain: 'localhost:3000',
    address,
    uri: 'http://localhost:3000/login',
    version: '1',
    chainId: 1,
    nonce,
    issuedAt: new Date().toISOString(),
    statement: 'Faça login sem senha usando sua carteira Ethereum.'
  });

  res.json({ message, nonce });
});

// Passo 2: Verificar a assinatura retornada pelo cliente
app.post('/auth/verify', async (req, res) => {
  const { message, signature, address } = req.body;

  const result = await verifier.verify(message, signature, address);

  if (!result.success) {
    return res.status(401).json({ error: result.message });
  }

  // Autenticação bem-sucedida — emitir sessão (ex: JWT)
  res.json({ success: true, address: result.address });
});
```

---

### 2. Token-Gating (verificar saldo de token ERC-20 on-chain)

```typescript
import { BlockchainVerifier } from '@tcc-auth/sdk-server-node';

// Conectar à blockchain via RPC (Infura, Alchemy, PublicNode, etc.)
const blockchain = new BlockchainVerifier('https://ethereum-rpc.publicnode.com');

// Verificar se usuário possui ao menos 1.0 LINK antes de liberar o login
const hasAccess = await blockchain.checkERC20Balance(
  userAddress,
  '0x514910771AF9Ca656af840dff83E8264EcF986CA', // Contrato do token LINK
  1.0  // Saldo mínimo
);

if (!hasAccess) {
  return res.status(403).json({ error: 'Saldo insuficiente de tokens para acessar este sistema.' });
}
```

---

### 3. NFT-Gating (verificar posse de NFT ERC-721)

```typescript
const ownsNft = await blockchain.checkERC721Ownership(
  userAddress,
  '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D' // BAYC NFT contract
);
```

---

### 4. Permissões On-chain via AccessControl (OpenZeppelin)

```typescript
import { keccak256, toUtf8Bytes } from 'ethers';

const ADMIN_ROLE = keccak256(toUtf8Bytes('ADMIN_ROLE'));

const isAdmin = await blockchain.checkRole(
  userAddress,
  '0xSeuContratoDeAcessoAqui',
  ADMIN_ROLE
);
```

---

### 5. Redis como armazenamento de nonces (produção multi-servidor)

Para ambientes com mais de um servidor ou deployments serverless (AWS Lambda, Vercel), use o `RedisNonceStore` no lugar do `MemoryNonceStore`:

```typescript
import { createClient } from 'redis';
import { RedisNonceStore, SiweVerifier } from '@tcc-auth/sdk-server-node';

const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

// Nonces expiram em 5 minutos, gerenciados automaticamente pelo Redis
const nonceStore = new RedisNonceStore(redisClient, 5 * 60 * 1000);
const verifier = new SiweVerifier('meudominio.com', nonceStore);
```

> **Por que Redis em produção?** O `MemoryNonceStore` armazena nonces na memória RAM de um único processo. Com múltiplos servidores atrás de um load balancer, um usuário que solicita o desafio no servidor A pode tentar verificar no servidor B, que não conhece o nonce. O Redis resolve isso armazenando nonces num banco central acessível por todos os servidores.

---

## API de Referência

### `MemoryNonceStore`

Armazenamento de nonces em memória RAM. Para uso em desenvolvimento ou ambientes com um único servidor.

| Método | Descrição |
|--------|-----------|
| `generate(address, ttlMs?)` | Gera e armazena um nonce seguro para o endereço. TTL padrão: 5 minutos. |
| `verify(address, nonce)` | Verifica o nonce e o **consome** (impossibilita replay). Retorna `Promise<boolean>`. |
| `cleanUp()` | Remove nonces expirados da memória. |

---

### `RedisNonceStore`

Armazenamento de nonces em Redis. Para uso em produção com múltiplos servidores.

| Parâmetro do Constructor | Tipo | Descrição |
|--------------------------|------|-----------|
| `redisClient` | `RedisClientType` | Instância ativa do cliente Redis v4 |
| `defaultTtlMs` | `number` | Tempo de vida do nonce em ms (padrão: 300000) |

---

### `SiweVerifier`

Verificador central de assinaturas no padrão EIP-4361 (Sign-In with Ethereum).

| Método | Descrição |
|--------|-----------|
| `verify(message, signature, address)` | Verifica a assinatura ECDSA, o nonce, o domínio e a expiração. Retorna `Promise<VerificationResult>`. |
| `parseMessage(messageText)` | Parseia a string da mensagem para um objeto estruturado. |
| `SiweVerifier.createMessage(params)` | (Estático) Formata uma string de mensagem válida no padrão EIP-4361. |

---

### `BlockchainVerifier`

Utilitários para consultas on-chain via RPC da Ethereum.

| Método | Descrição |
|--------|-----------|
| `checkERC20Balance(address, tokenContract, minBalance)` | Verifica saldo mínimo de token ERC-20. |
| `checkERC721Ownership(address, nftContract)` | Verifica se o usuário possui algum NFT da coleção. |
| `checkRole(address, aclContract, roleHash)` | Verifica permissão no padrão AccessControl da OpenZeppelin. |

---

## Modelo de Segurança

Este SDK implementa as seguintes defesas criptográficas:

| Ameaça | Defesa Implementada |
|--------|---------------------|
| **Ataque de Replay** | Cada nonce é de uso único e expira após ser consumido ou após o TTL configurado. |
| **Falsificação de Identidade** | A biblioteca `ethers` recupera o endereço Ethereum matematicamente da assinatura e compara com o alegado pelo cliente. Qualquer divergência é rejeitada. |
| **Phishing** | A mensagem EIP-4361 inclui o domínio do servidor. O verificador rejeita mensagens assinadas para domínios diferentes. |
| **Man-in-the-Middle** | A assinatura é sobre a mensagem completa. Qualquer alteração na mensagem invalida a assinatura matematicamente. |
| **Senhas expostas em vazamentos** | Não existem senhas. A prova de identidade é a posse da chave privada (nunca transmitida). |

---

## Requisitos

- **Node.js** >= 18.0.0
- **ethers** >= 6.0.0
- **redis** >= 4.0.0 (opcional, somente para `RedisNonceStore`)

---

## Licença

[MIT](./LICENSE) © Thiago Martin — UFSM, 2026
