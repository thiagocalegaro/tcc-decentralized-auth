# Walkthrough: Backend de Autenticação Descentralizada

Este documento apresenta o resumo dos artefatos desenvolvidos e o resultado das validações de segurança para o protótipo de autenticação descentralizada do seu TCC.

---

## Arquitetura Implementada (Fase 1 e Fase 2 Concluídas)

A lógica criptográfica é fornecida em forma de biblioteca que roda localmente no backend de cada aplicação cliente. Com a conclusão da **Fase 2 (Integração com Smart Contracts)**, o SDK agora é capaz de consultar a blockchain em tempo real (via nós RPC) para validar políticas de acesso baseado em saldo de tokens (Token-Gating), posse de NFTs (NFT-Gating) ou permissões em contratos de ACL (AccessControl).

```mermaid
sequenceDiagram
    autonumber
    actor Cliente as Navegador (MetaMask)
    participant AppAPI as API do Aplicativo (Express + Seu SDK)
    participant Redis as Banco de Nonces (Memory ou Redis)
    participant Blockchain as Ethereum Network (via RPC)
    
    Cliente->>AppAPI: 1. GET /challenge?address=0x...
    Note over AppAPI: sdk-server-node gera Nonce temporário
    AppAPI->>Redis: 2. Salva nonce assincronamente (SET com TTL)
    AppAPI-->>Cliente: 3. Retorna Mensagem EIP-4361 com Nonce
    Cliente->>Cliente: 4. Assina mensagem com Chave Privada (Offline/ECDSA)
    Cliente->>AppAPI: 5. POST /verify {message, signature, address, gated: true}
    AppAPI->>Redis: 6. Recupera e valida nonce assincronamente (GET & DEL)
    Note over AppAPI: sdk-server-node recupera Chave Pública da assinatura
    AppAPI->>Blockchain: 7. Consulta saldo de token do endereço (balanceOf)
    Blockchain-->>AppAPI: 8. Retorna saldo (ex: 0 LINK)
    Note over AppAPI: sdk-server-node valida se saldo >= mínimo
    AppAPI-->>Cliente: 9. Retorna erro 403 (se saldo insuficiente) ou JWT (se válido)
```

---

## Estrutura de Arquivos Criados

Os projetos foram criados em [tcc-decentralized-auth](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth):

1.  **`package.json` raiz:** Configura o monorepo utilizando npm workspaces.
2.  **`sdk-server-node/` (Biblioteca/SDK):**
    *   [types.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/sdk-server-node/src/types.ts): Interfaces para a mensagem SIWE (EIP-4361) e resultado da verificação.
    *   [nonce.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/sdk-server-node/src/nonce.ts): Contém a interface assíncrona `NonceStore` e duas implementações (`MemoryNonceStore` e `RedisNonceStore`).
    *   [verifier.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/sdk-server-node/src/verifier.ts): Validador central que executa a verificação matemática ECDSA offline.
    *   [contracts.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/sdk-server-node/src/contracts.ts) (Novo!): Classe `BlockchainVerifier` que implementa consultas on-chain usando `ethers` v6:
        *   `checkERC20Balance`: Valida saldo mínimo de qualquer token ERC-20.
        *   `checkERC721Ownership`: Valida posse de NFTs (coleções ERC-721).
        *   `checkRole`: Valida permissões (roles) no padrão de controle de acesso da OpenZeppelin.
3.  **`demo-backend-node/` (API Demonstrativa):**
    *   [index.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/demo-backend-node/src/index.ts): Servidor Express assíncrono que expõe `/auth/challenge`, `/auth/verify` (integrando a lógica de Token-Gating) e a rota protegida `/user/profile`.
    *   [test-client.ts](file:///C:/Users/get10/.gemini/antigravity/scratch/tcc-decentralized-auth/demo-backend-node/src/test-client.ts): Simulador que atua como cliente e MetaMask para validar o fluxo completo e testar vulnerabilidades.

---

## Resultados das Validações (Fase 2)

O simulador foi executado com sucesso e os seguintes testes foram realizados:

### 1. Fluxo de Autenticação Tradicional (Sem Gating)
*   **Ação:** Usuário solicita nonce, assina localmente e envia para `/verify` (sem restrição on-chain).
*   **Resultado:** Assinatura ECDSA validada localmente, emissão do JWT e acesso liberado à rota protegida.

### 2. Testes de Resiliência
*   **Ataque de Replay (Prevenido):** Tentativas repetidas de envio da mesma assinatura falham porque o nonce é consumido no primeiro uso.
*   **Falsificação de Endereço (Prevenido):** Enviar assinatura de um endereço alegando pertencer a outro falha na decodificação de curvas elípticas.

### 3. Token-Gating On-Chain (Validado)
*   **Ação:** Usuário solicita autenticação enviando `gated: true`. O backend está configurado para exigir saldo mínimo de `1.0 LINK` no contrato oficial da Chainlink na rede Ethereum Mainnet (`0x514910771AF9Ca656af840dff83E8264EcF986CA`), conectando via nó RPC da `PublicNode`.
*   **Resultado:** O backend realiza a consulta on-chain, verifica que a carteira gerada aleatoriamente possui saldo `0.0 LINK` e rejeita o login com a mensagem: `"Acesso negado por Token-Gating: você precisa de pelo menos 1 tokens no endereço 0x514910771AF9Ca656af840dff83E8264EcF986CA..."`.
*   **Explicação:** A verificação on-chain funciona de forma integrada com a rede real da Ethereum, conectando e lendo dados de contratos inteligentes reais em tempo real.

---

## Log de Execução dos Testes (Fase 2)

Abaixo está o log real da execução do script de simulação contemplando o novo teste de Token-Gating:

```text
==================================================
INICIANDO SIMULADOR DE AUTENTICAÇÃO DESCENTRALIZADA
==================================================

[Passo 1] Carteira gerada com sucesso!
 - Endereço Público: 0x9c07EBe7FFA1A4678Ee3912bacc55758002b0E03
 - Chave Privada: 0x85cd973bcd5054d2fd29bdf3324687809e1b6a7bd6b32840ee89d2faa9380995

[Passo 2] Solicitando desafio para o endereço no backend...
 - Desafio Recebido do Servidor (Formato SIWE / EIP-4361):
--------------------------------------------------
localhost:3000 wants you to sign in with your Ethereum account:
0x9c07EBe7FFA1A4678Ee3912bacc55758002b0E03

Assine esta mensagem para provar que você é dono da chave privada deste endereço. Sem taxas de gás.

URI: http://localhost:3000/login
Version: 1
Chain ID: 1
Nonce: 64a94f4e2f2c40336db51b4c0ba54d58
Issued At: 2026-06-30T19:57:42.879Z
Expiration Time: 2026-06-30T20:07:42.882Z
--------------------------------------------------

[Passo 3] Assinando o desafio com a chave privada do usuário (Offline/ECDSA)...
 - Assinatura gerada (Hex): 0x96616dafe0db7c3382b35c78a96958579358f4a193d023932e1e721886caa6664ab8fb2845b8fa8caa5acdd0fad9f7fb60eb8db55f2aec88f96e4d239565aef31c

[Passo 4] Enviando assinatura e mensagem para verificação no endpoint POST /api/auth/verify (Sem Token-Gating)...
 - Resposta do Servidor: {
  success: true,
  message: 'Autenticação bem-sucedida.',
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhZGRyZXNzIjoiMHg5YzA3RUJlN0ZGQTFBNDY3OEVlMzkxMmJhY2M1NTc1ODAwMmIwRTAzIiwiaWF0IjoxNzgyODQ5NDYzLCJleHAiOjE3ODI4NTI5NjN9.PUhqCxCNyL6yMtyjd4PsMwpUuCTBfEFedweNqhde6S4',
  address: '0x9c07EBe7FFA1A4678Ee3912bacc55758002b0E03'
}
 - Token JWT Recebido com Sucesso!

[Passo 5] Testando acesso a recurso protegido enviando o JWT recebido...
 - Resposta da Rota Protegida /api/user/profile: {
  success: true,
  message: 'Acesso autorizado a rota protegida.',
  userAddress: '0x9c07EBe7FFA1A4678Ee3912bacc55758002b0E03',
  description: 'Estes dados só podem ser vistos porque a assinatura criptográfica da blockchain foi verificada com sucesso offline por nossa biblioteca, emitindo um token JWT válido.'
}

==================================================
TESTES DE AUTENTICAÇÃO BEM-SUCEDIDA CONCLUÍDOS
==================================================

==================================================
INICIANDO TESTES DE SEGURANÇA E RESILIÊNCIA
==================================================

[Teste A] Tentando ataque de replay (enviar a mesma assinatura novamente)...
 - Resultado do Replay (Deve falhar): success = false, erro = "Nonce inválido, expirado ou já utilizado."
✅ SUCESSO: O servidor detectou e impediu o ataque de replay.

[Teste B] Tentando falsificar identidade (enviar assinatura válida com outro endereço)...
 - Resultado da Falsificação (Deve falhar): success = false, erro = "A assinatura criptográfica não coincide com o endereço informado."
✅ SUCESSO: O servidor detectou a divergência criptográfica.

[Teste C] Testando Token-Gating (tentar login exigindo saldo de token on-chain)...
 - Resultado do Token-Gating (Deve falhar por saldo = 0): success = false, erro = "Acesso negado por Token-Gating: você precisa de pelo menos 1 tokens no endereço 0x514910771AF9Ca656af840dff83E8264EcF986CA para autenticar."
✅ SUCESSO: O servidor conectou à blockchain via RPC e rejeitou o acesso por saldo insuficiente.

==================================================
FIM DOS TESTES DE SEGURANÇA
==================================================
```
