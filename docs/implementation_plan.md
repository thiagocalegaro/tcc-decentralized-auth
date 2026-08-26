# Plano de Implementação: Backend de Autenticação Descentralizada (Foco Único)

Conforme sua orientação, **pausaremos a parte de frontend por enquanto e focaremos 100% no desenvolvimento da lógica do Backend**. 

Isso nos permitirá construir um núcleo criptográfico robusto e testável, desenvolvendo a biblioteca de validação e a API de demonstração primeiro. Validaremos todo o funcionamento do fluxo usando scripts de simulação que geram chaves e assinaturas via código.

---

## Estrutura do Workspace

O projeto será criado no seguinte caminho no seu diretório `scratch`:
`C:\Users\get10\.gemini\antigravity\scratch\tcc-decentralized-auth\`

```text
tcc-decentralized-auth/
├── sdk-server-node/    # SDK para backend Node.js (TypeScript / Ethers.js)
├── demo-backend-node/  # API de exemplo (Express / TS) consumindo a biblioteca local
└── scratch/            # Scripts de teste/simulação de cliente (MetaMask simulator)
```

---

## Detalhamento Técnico das Camadas Backend

### 1. Biblioteca Server-Side (`sdk-server-node`)
Este será o pacote/módulo TypeScript reutilizável. Ele conterá:
*   **`NonceGenerator`**: Função para gerar um nonce seguro e gerenciar sua expiração temporal (proteção contra replay attack).
*   **`SignatureVerifier`**:
    *   Recebe a mensagem original (EIP-4361), a assinatura criptográfica hexadecimal e o endereço Ethereum alegado pelo usuário.
    *   Faz a recuperação offline da chave pública utilizando curvas elípticas (função `verifyMessage` da biblioteca `ethers`).
    *   Valida se a mensagem respeita os padrões do EIP-4361 (ex: se o nonce é válido, se o domínio está correto, se a mensagem não expirou).
    *   Retorna `true` se a validação criptográfica for bem-sucedida.

### 2. Demo API (`demo-backend-node`)
Um servidor REST simples em Express (TypeScript) que simula o backend de um aplicativo cliente:
*   **Dependência Local:** Importará a biblioteca `sdk-server-node` localmente (via link relativo ou configuração de workspace npm).
*   **Endpoints:**
    *   `GET /api/auth/challenge?address=0x...`: Gera um nonce associado ao endereço do usuário e armazena temporariamente em cache/memória do servidor. Retorna o texto formatado no padrão SIWE (EIP-4361).
    *   `POST /api/auth/verify`: Recebe o payload com a mensagem original, a assinatura e o endereço. Utiliza o `sdk-server-node` para verificar. Se válido, retorna um JWT assinado pelo servidor.

---

## Plano de Verificação (Sem Frontend)

Como não desenvolveremos o frontend no momento, usaremos testes automatizados e scripts de simulação:

### 1. Testes Unitários (`sdk-server-node`)
*   Testar se assinaturas válidas são corretamente confirmadas.
*   Testar se assinaturas com nonces alterados ou expirados são rejeitadas.

### 2. Simulador de Cliente (`scratch/test-client.ts`)
*   Criaremos um script utilitário que atua como a MetaMask:
    1. Gera um par de chaves Ethereum (endereço público e chave privada) de teste de forma randômica.
    2. Faz uma chamada HTTP `GET` para a `demo-backend-node` para solicitar o desafio de login.
    3. Assina a mensagem de desafio usando a chave privada local (simulando a ação física de assinatura na MetaMask).
    4. Faz um `POST` para o endpoint `/verify` enviando a assinatura.
    5. Confirma se a API retorna com sucesso o JWT e se o JWT gerado contém o endereço Ethereum correto.
