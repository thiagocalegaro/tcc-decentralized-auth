# Guia de Integração para Desenvolvedores

> Como adicionar login descentralizado com carteira Ethereum ao seu projeto em menos de 30 minutos.

Este guia assume que o desenvolvedor tem um projeto Node.js/TypeScript existente (Express, Fastify, NestJS ou similar) e quer substituir ou complementar o login tradicional (e-mail/senha) com autenticação via carteira blockchain (MetaMask).

---

## Passo 1: Instalar o SDK

No terminal, dentro do diretório do seu projeto backend:

```bash
npm install @tcc-auth/sdk-server-node
```

Isso instala o SDK e a dependência obrigatória `ethers` (criptografia Ethereum).

> **Nota:** Se você pretende rodar em produção com múltiplos servidores, instale também o Redis:
> ```bash
> npm install redis
> ```

---

## Passo 2: Configurar o Backend

### 2.1 — Importar e instanciar o SDK

Abra o arquivo principal do seu servidor (ex: `app.ts`, `server.ts`, `index.ts`) e adicione:

```typescript
import { MemoryNonceStore, SiweVerifier } from '@tcc-auth/sdk-server-node';

// O domínio deve ser exatamente o que aparece na barra de endereço do navegador do usuário
const DOMAIN = 'meusite.com';

// Cria o armazenamento de nonces (em memória para dev, Redis para produção)
const nonceStore = new MemoryNonceStore(); // nonces expiram em 5 min por padrão

// Cria o verificador de assinaturas vinculado ao seu domínio
const verifier = new SiweVerifier(DOMAIN, nonceStore);
```

### 2.2 — Criar o endpoint de desafio (Challenge)

Este endpoint é chamado pelo frontend quando o usuário clica em "Entrar com MetaMask". Ele gera uma mensagem única e temporária que o usuário deve assinar.

```typescript
import { getAddress } from 'ethers';

app.get('/api/auth/challenge', async (req, res) => {
  const address = req.query.address as string;

  // Validar que o endereço foi fornecido
  if (!address) {
    return res.status(400).json({ error: 'Parâmetro address é obrigatório.' });
  }

  try {
    // Normalizar endereço (checksum EIP-55)
    const formattedAddress = getAddress(address);

    // Gerar nonce aleatório e armazená-lo associado ao endereço
    const nonce = await nonceStore.generate(formattedAddress);

    // Montar a mensagem no padrão EIP-4361 (Sign-In with Ethereum)
    const message = SiweVerifier.createMessage({
      domain: DOMAIN,
      address: formattedAddress,
      statement: 'Faça login no Meu App sem usar senha.',
      uri: `https://${DOMAIN}/login`,
      version: '1',
      chainId: 1,           // 1 = Ethereum Mainnet
      nonce,
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min
    });

    return res.json({ message, nonce });
  } catch {
    return res.status(400).json({ error: 'Endereço Ethereum inválido.' });
  }
});
```

### 2.3 — Criar o endpoint de verificação (Verify)

Este endpoint recebe a assinatura do frontend, valida matematicamente e emite a sessão.

```typescript
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'troque-por-uma-chave-forte';

app.post('/api/auth/verify', async (req, res) => {
  const { message, signature, address } = req.body;

  if (!message || !signature || !address) {
    return res.status(400).json({ error: 'Campos message, signature e address são obrigatórios.' });
  }

  // O SDK faz TUDO internamente:
  // 1. Recupera o endereço real da assinatura (ECDSA)
  // 2. Compara com o endereço declarado
  // 3. Valida o domínio da mensagem
  // 4. Verifica e consome o nonce
  // 5. Checa expiração
  const result = await verifier.verify(message, signature, address);

  if (!result.success) {
    return res.status(401).json({ error: result.message });
  }

  // Autenticação bem-sucedida!
  // Aqui você emite a sessão da forma que seu projeto já usa.
  // Pode ser JWT, cookie de sessão, etc.
  const token = jwt.sign(
    { address: result.address },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  return res.json({ success: true, token, address: result.address });
});
```

**Pronto!** O backend está configurado. São apenas **2 endpoints** e **3 linhas de configuração do SDK**.

---

## Passo 3: Configurar o Frontend

No frontend, você precisa interagir com a carteira MetaMask do usuário. A MetaMask injeta um objeto `window.ethereum` no navegador que permite solicitar conexão e assinaturas.

### 3.1 — Botão de Login

```html
<button id="btn-login">Entrar com MetaMask</button>
```

### 3.2 — Script de autenticação

```javascript
document.getElementById('btn-login').addEventListener('click', async () => {

  // ============================================
  // ETAPA 1: Verificar se a MetaMask está instalada
  // ============================================
  if (typeof window.ethereum === 'undefined') {
    alert('MetaMask não detectada. Instale em https://metamask.io');
    return;
  }

  // ============================================
  // ETAPA 2: Solicitar conexão da carteira
  // ============================================
  // Isso abre o popup da MetaMask pedindo permissão para o site ver o endereço público.
  const accounts = await window.ethereum.request({
    method: 'eth_requestAccounts'
  });
  const userAddress = accounts[0];
  console.log('Carteira conectada:', userAddress);

  // ============================================
  // ETAPA 3: Solicitar desafio ao backend
  // ============================================
  const challengeRes = await fetch(`/api/auth/challenge?address=${userAddress}`);
  const { message } = await challengeRes.json();

  // ============================================
  // ETAPA 4: Pedir ao usuário para assinar o desafio
  // ============================================
  // A MetaMask abre um popup mostrando a mensagem e pedindo confirmação.
  // A chave privada NUNCA sai do dispositivo — a assinatura é feita localmente.
  const signature = await window.ethereum.request({
    method: 'personal_sign',
    params: [message, userAddress]
  });

  // ============================================
  // ETAPA 5: Enviar assinatura para o backend verificar
  // ============================================
  const verifyRes = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, signature, address: userAddress })
  });
  const data = await verifyRes.json();

  if (data.success) {
    // ============================================
    // ETAPA 6: Login bem-sucedido! Armazenar sessão
    // ============================================
    localStorage.setItem('token', data.token);
    console.log('Autenticado como:', data.address);
    // Redirecionar para o dashboard, recarregar a página, etc.
  } else {
    alert('Falha no login: ' + data.error);
  }
});
```

### 3.3 — Usar o token nas requisições autenticadas

Após o login, o frontend envia o JWT em todas as requisições a rotas protegidas:

```javascript
const res = await fetch('/api/user/profile', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  }
});
const profile = await res.json();
```

---

## Passo 4 (Opcional): Adicionar Token-Gating

Se o seu projeto quer restringir o acesso a usuários que possuem determinados tokens ou NFTs na blockchain, adicione o `BlockchainVerifier`:

### 4.1 — Configurar no backend

```typescript
import { BlockchainVerifier } from '@tcc-auth/sdk-server-node';

// Conectar à rede Ethereum via RPC (use Infura, Alchemy ou PublicNode)
const blockchain = new BlockchainVerifier('https://ethereum-rpc.publicnode.com');
```

### 4.2 — Verificar saldo após a autenticação

Dentro do endpoint `/api/auth/verify`, após a verificação ECDSA ser bem-sucedida:

```typescript
// Exigir que o usuário tenha pelo menos 100 USDC para acessar
const hasAccess = await blockchain.checkERC20Balance(
  result.address,
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Contrato do USDC
  100.0
);

if (!hasAccess) {
  return res.status(403).json({
    error: 'Você precisa de ao menos 100 USDC para acessar esta plataforma.'
  });
}
```

### 4.3 — Ou verificar posse de NFT

```typescript
// Exigir que o usuário possua pelo menos 1 NFT da coleção
const isHolder = await blockchain.checkERC721Ownership(
  result.address,
  '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D' // Bored Ape Yacht Club
);

if (!isHolder) {
  return res.status(403).json({
    error: 'Acesso exclusivo para holders de NFTs desta coleção.'
  });
}
```

---

## Passo 5 (Produção): Trocar para Redis

Em produção com mais de um servidor (load balancer, Kubernetes, serverless), o `MemoryNonceStore` não funciona porque cada servidor tem sua própria memória. Troque por Redis:

```typescript
import { createClient } from 'redis';
import { RedisNonceStore, SiweVerifier } from '@tcc-auth/sdk-server-node';

// Conectar ao Redis
const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

// Substituir MemoryNonceStore por RedisNonceStore (mesma interface)
const nonceStore = new RedisNonceStore(redisClient);
const verifier = new SiweVerifier('meusite.com', nonceStore);

// O restante do código não muda em NADA.
// Os endpoints /challenge e /verify continuam iguais.
```

A mudança é **1 linha**. O restante do código permanece idêntico.

---

## Passo 6: Tratamento de Erros no Frontend

Para uma boa experiência do usuário, trate os erros comuns da MetaMask:

```javascript
try {
  const signature = await window.ethereum.request({
    method: 'personal_sign',
    params: [message, userAddress]
  });
  // ... continuar com a verificação
} catch (error) {
  if (error.code === 4001) {
    // O usuário clicou em "Rejeitar" no popup da MetaMask
    alert('Você precisa assinar a mensagem para fazer login.');
  } else if (error.code === -32002) {
    // Já existe um popup da MetaMask aberto
    alert('Verifique a janela da MetaMask que já está aberta.');
  } else {
    alert('Erro inesperado: ' + error.message);
  }
}
```

---

## Resumo: O que o Desenvolvedor Precisa Fazer

| Etapa | O que fazer | Tempo estimado |
|-------|-------------|----------------|
| 1 | `npm install @tcc-auth/sdk-server-node` | 30 segundos |
| 2 | Criar `GET /challenge` e `POST /verify` no backend (copiar o código acima) | 10 minutos |
| 3 | Adicionar botão "Entrar com MetaMask" e o script JS no frontend | 10 minutos |
| 4 | (Opcional) Adicionar Token-Gating ou NFT-Gating | 5 minutos |
| 5 | (Produção) Trocar `MemoryNonceStore` por `RedisNonceStore` | 2 minutos |

### O que o desenvolvedor NÃO precisa fazer:
- ❌ Criar tabela de usuários no banco de dados
- ❌ Implementar hash de senhas (bcrypt, argon2)
- ❌ Implementar fluxo de "esqueci minha senha"
- ❌ Gerenciar e-mails de verificação
- ❌ Lidar com vazamento de credenciais
- ❌ Entender criptografia de curvas elípticas (o SDK abstrai tudo)
