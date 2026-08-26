# Preparação para a Banca: Perguntas e Respostas

> Documento de apoio para a defesa do TCC **"Sistema de Autenticação Descentralizada Baseado em Blockchain para Aplicações Web"** — UFSM, 2026.

Este documento compila as perguntas críticas que a banca avaliadora pode fazer, organizadas por tema, com respostas fundamentadas e honestas — incluindo reconhecimento de limitações onde elas existem.

---

## 1. Fluxo do Sistema

### P: "Explique o fluxo completo de autenticação do seu sistema."

O sistema possui 3 atores (Usuário com carteira, Backend com o SDK, Blockchain via RPC) e funciona em 6 etapas:

**Etapa 1 — Solicitação de desafio:** O frontend solicita ao backend um desafio de autenticação (`GET /challenge`). O backend gera um **nonce** (número aleatório, criptograficamente seguro, de uso único, com validade de 5 minutos) e monta uma **mensagem padronizada EIP-4361 (Sign-In with Ethereum)** contendo o domínio, o endereço do usuário, o nonce e timestamps.

**Etapa 2 — Assinatura ECDSA:** O frontend exibe o popup da carteira (ex: MetaMask). O usuário lê a mensagem e clica em "Assinar". A carteira aplica o algoritmo **ECDSA** sobre a curva elíptica **secp256k1**: calcula o hash Keccak-256 da mensagem, combina-o com a chave privada usando operações na curva, e produz uma assinatura de 65 bytes `(r, s, v)`. **A chave privada nunca é transmitida.**

**Etapa 3 — Envio da assinatura:** O frontend envia ao backend a mensagem original, a assinatura e o endereço declarado (`POST /verify`).

**Etapa 4 — Verificação (núcleo do SDK):** O SDK executa 5 validações em sequência:
1. **ecrecover** — Recupera matematicamente o endereço público do assinante a partir da assinatura e compara com o declarado. Se divergem → falsificação detectada.
2. **Domínio** — Verifica que a mensagem foi assinada para o domínio correto. Se diferente → phishing bloqueado.
3. **Nonce** — Busca o nonce armazenado, valida e **deleta imediatamente** (uso único). Se inválido/expirado/já usado → replay attack bloqueado.
4. **Expiração** — Verifica timestamps da mensagem.
5. **(Opcional) Token-Gating** — Consulta a blockchain via RPC para verificar saldo de tokens ERC-20, posse de NFTs ERC-721 ou roles on-chain.

**Etapa 5 — Sessão JWT:** Se todas as validações passam, o backend emite um JWT convencional contendo o endereço verificado.

**Etapa 6 — Acesso protegido:** O frontend usa o JWT em requisições subsequentes, como em qualquer aplicação Web2 tradicional.

---

## 2. Papel da Blockchain

### P: "Onde exatamente a blockchain entra no seu sistema?"

A blockchain desempenha **3 papéis** no sistema:

**1. Sistema de Identidade Global (papel fundamental):**
A blockchain Ethereum fornece um registro de identidades descentralizado e sem dono. Qualquer pessoa pode gerar um endereço (identidade) sem pedir permissão a nenhuma autoridade. O endereço é **auto-certificável**: é matematicamente derivado da chave pública, sem necessidade de uma Autoridade Certificadora para emiti-lo ou revogá-lo.

**2. Camada de Autorização Programável:**
O Token-Gating (verificação de saldo ERC-20, posse de NFT ERC-721, roles via AccessControl da OpenZeppelin) só é possível consultando o estado imutável da blockchain. Nenhum sistema centralizado oferece essa funcionalidade com as mesmas propriedades de transparência e imutabilidade.

**3. Infraestrutura e Ecossistema:**
MetaMask, ethers.js, EIP-4361, ENS — todo esse ecossistema de carteiras, bibliotecas e padrões existe por causa da blockchain. Milhões de usuários já possuem carteiras. O SDK não precisa criar infraestrutura do zero.

> **Ponto importante:** A verificação principal (ECDSA/ecrecover) é **100% offline** — não faz nenhuma chamada à blockchain. A blockchain só é consultada opcionalmente no Token-Gating.

### P: "A blockchain é realmente necessária? Poderia fazer sem ela?"

**Resposta honesta: a verificação criptográfica em si pode ser feita sem blockchain.** Assinaturas digitais com chave pública existem desde os anos 1970 (SSH, PGP, TLS Client Certificates, e mais recentemente WebAuthn/Passkeys usam o mesmo princípio).

No entanto, todas as alternativas sem blockchain **reintroduzem centralização**:

| Alternativa | Problema de centralização |
|------------|--------------------------|
| SSH Keys | O servidor mantém uma lista de chaves autorizadas. Quem gerencia → centralizado. |
| TLS Client Certificates | Requer uma Autoridade Certificadora (CA) para emitir e revogar → centralizado. |
| WebAuthn / Passkeys | Chave vinculada à plataforma (Apple, Google). Trocar de ecossistema = perder acesso → vendor lock-in. |
| PGP | Sem registro global de identidades. O "web of trust" fracassou por falta de adoção. |

A blockchain resolve o **Problema da Distribuição de Chaves**: em criptografia de chave pública, o desafio não é gerar chaves, mas saber *qual chave pertence a quem* sem depender de uma autoridade central para certificar isso. A blockchain é um registro público, imutável e sem dono onde cada endereço é uma identidade auto-certificável.

Além disso, funcionalidades como Token-Gating e controle de acesso on-chain são **exclusivas** da blockchain.

> **Resposta para a banca:** *"Sim, a verificação criptográfica ECDSA pode ser feita sem blockchain — é matemática pura que antecede o Bitcoin. No entanto, a blockchain resolve um problema que as alternativas não resolvem: o registro descentralizado de identidades. Sem ela, seria necessário uma autoridade central para certificar qual chave pública pertence a qual usuário. A blockchain elimina essa dependência ao tornar cada endereço Ethereum uma identidade auto-certificável. Além disso, o Token-Gating e o controle de acesso on-chain são funcionalidades exclusivas da blockchain."*

---

## 3. Descentralização e MetaMask

### P: "A MetaMask não centraliza a chave privada? Isso não contradiz a proposta de descentralização?"

A MetaMask **não é um banco de dados centralizado**. É um cofre local — a chave privada fica criptografada no armazenamento do navegador, no dispositivo do usuário. Os servidores da ConsenSys (empresa que mantém a MetaMask) nunca recebem nem armazenam a chave privada.

A confusão está no significado de "descentralização" neste contexto:
- **Não significa** que a chave está distribuída em vários lugares.
- **Significa** que nenhuma autoridade central controla a identidade do usuário.

O termo mais preciso na literatura acadêmica é **Identidade Auto-Soberana (Self-Sovereign Identity / SSI)**.

| Aspecto | Autenticação Centralizada (Web2) | Autenticação Descentralizada (Web3) |
|---------|:---:|:---:|
| Quem controla a identidade | A empresa (Google, Facebook) | O próprio usuário |
| Pode revogar seu acesso | Sim, unilateralmente | Não — ninguém pode |
| Se a empresa desaparecer | Perde o acesso | Identidade continua existindo |
| Portabilidade entre apps | Não (cada app tem seu cadastro) | Sim (um endereço funciona em qualquer app) |

**Ponto crucial:** A MetaMask é apenas **uma das opções** de carteira. O SDK não depende dela. Qualquer ferramenta que produza uma assinatura ECDSA/secp256k1 válida funciona:

| Carteira | Tipo | Onde a chave fica |
|----------|------|-------------------|
| MetaMask | Software (extensão) | Criptografada no navegador |
| Ledger / Trezor | Hardware (dispositivo físico) | Num chip isolado, offline |
| Trust Wallet | Software (celular) | Criptografada no smartphone |
| Paper Wallet | Papel físico | Anotada num papel, 100% offline |

**Limitações reconhecidas (honestidade acadêmica):**
- A segurança da chave depende da segurança do dispositivo/carteira do usuário.
- MetaMask, como software de uma única empresa, poderia teoricamente publicar uma atualização maliciosa.
- **Mitigação:** carteiras de hardware (Ledger, Trezor) isolam a chave num chip dedicado.
- **Trabalho futuro:** esquemas de MPC (Multi-Party Computation) onde a chave é fragmentada entre múltiplos dispositivos.

> **Resposta para a banca:** *"A MetaMask é uma das implementações possíveis de carteira, não um componente obrigatório do sistema. A descentralização não se refere à distribuição física da chave privada, mas à eliminação de uma autoridade central que controla as credenciais. O usuário é soberano sobre sua identidade: pode usar qualquer carteira compatível com ECDSA/secp256k1, inclusive carteiras de hardware como Ledger que armazenam a chave num chip isolado. O SDK verifica a prova matemática da assinatura, independentemente de qual ferramenta a produziu."*

---

## 4. Geração da Chave Privada

### P: "Como a chave privada é gerada?"

O processo tem 4 etapas, todas executadas localmente no dispositivo do usuário:

**Etapa 1 — Entropia:** O gerador criptográfico do sistema operacional produz 128 bits de dados aleatórios puros. Existem 2¹²⁸ (~3.4 × 10³⁸) combinações possíveis, tornando adivinhação por força bruta computacionalmente impossível.

**Etapa 2 — Seed Phrase (BIP-39):** A entropia é convertida em 12 palavras legíveis usando o padrão BIP-39. Cada grupo de 11 bits mapeia para uma palavra numa lista padronizada de 2048 palavras. Essas 12 palavras **são** a representação humana da chave — quem souber as palavras pode reconstruir toda a chave privada.

**Etapa 3 — Derivação da Chave Privada (BIP-32/BIP-44):** A seed phrase passa pela função PBKDF2-HMAC-SHA512 (2048 iterações), gerando uma seed de 512 bits. A partir dela, uma árvore hierárquica de chaves é derivada pelo caminho `m/44'/60'/0'/0/0`. O resultado final é um **número de 256 bits** — este número é a chave privada.

**Etapa 4 — Chave Pública e Endereço:** A chave privada é multiplicada pelo ponto gerador G na curva elíptica secp256k1 (`Chave Pública = chave_privada × G`). Esta operação é fácil num sentido e impossível de reverter (problema do logaritmo discreto). O endereço Ethereum é os últimos 20 bytes do hash Keccak-256 da chave pública.

```
12 palavras (BIP-39)
       ↓
PBKDF2-HMAC-SHA512
       ↓
Seed (512 bits) → Derivação BIP-32/44
       ↓
CHAVE PRIVADA (256 bits) — o segredo, nunca sai do dispositivo
       ↓  × G (curva secp256k1)
CHAVE PÚBLICA (ponto x,y na curva)
       ↓  Keccak-256, últimos 20 bytes
ENDEREÇO ETHEREUM (0x8fAD...) — a identidade pública
```

> **Resposta para a banca:** *"A geração é local e independente. Não requer servidor, internet ou permissão de nenhuma autoridade. A carteira gera 128 bits de entropia pura, converte em 12 palavras mnemônicas (BIP-39), deriva a chave privada hierarquicamente (BIP-32/44), e calcula o endereço Ethereum por multiplicação na curva elíptica secp256k1 seguida de hash Keccak-256. Todo o processo ocorre offline no dispositivo do usuário."*

---

## 5. Identificação do Usuário

### P: "Como a aplicação do desenvolvedor sabe quem é quem? Precisa de banco de dados?"

O endereço Ethereum (`0xABC...`) é o **identificador universal** do usuário — ele substitui o e-mail/username como chave primária. É globalmente único, permanente e criptograficamente verificável.

**O SDK resolve autenticação, não gerenciamento de usuários.** São responsabilidades distintas:
- **Autenticação** = "esta pessoa é quem diz ser?" → Resolvido pelo SDK (sem banco de dados).
- **Gerenciamento** = "qual é o nome e o e-mail desta pessoa?" → Responsabilidade da aplicação do desenvolvedor.

Na prática, existem 3 cenários:

**Cenário A — Web3 Pura (sem banco):** O usuário é identificado apenas pelo endereço `0xABC...`. Sem nome, sem e-mail. Ideal para aplicações anônimas (votação, acesso gated).

**Cenário B — Híbrido (mais comum):** No primeiro login, a aplicação detecta que o endereço é novo e pede ao usuário para completar um perfil (nome, e-mail). Nos logins seguintes, busca o perfil pelo endereço. A tabela no banco:

```
Modelo Tradicional: users (id, email, password_hash, name)
Nosso Modelo:       users (id, wallet_address, email?, name?)
                                               ↑ sem password_hash
```

**Cenário C — ENS (Ethereum Name Service):** O endereço pode ser resolvido para um nome legível registrado na blockchain (ex: `thiago.eth`), sem banco de dados.

> **Resposta para a banca:** *"O endereço Ethereum é o identificador universal — como um CPF criptográfico. O SDK elimina a necessidade de armazenar senhas, mas a aplicação pode opcionalmente manter um banco de dados para dados de perfil (nome, e-mail) vinculados ao endereço. A diferença fundamental é que a coluna password_hash desaparece completamente."*

---

## 6. Segurança

### P: "Quais ameaças o sistema protege e como?"

| Ameaça | Defesa Implementada | Mecanismo Técnico |
|--------|---------------------|-------------------|
| **Roubo de senha** | Não existe senha | A identidade é a posse da chave privada, nunca transmitida |
| **Replay Attack** | Nonce de uso único | Gerado aleatoriamente, consumido e deletado na primeira verificação |
| **Falsificação de identidade** | Verificação ECDSA (ecrecover) | Recuperação matemática do endereço na curva elíptica |
| **Phishing** | Validação de domínio EIP-4361 | Mensagem inclui domínio; servidor rejeita domínios diferentes |
| **Man-in-the-Middle** | Integridade da assinatura | Qualquer alteração na mensagem invalida a assinatura (hash muda) |
| **Vazamento de banco de dados** | Sem credenciais armazenadas | Nada para vazar — não há tabela de senhas |
| **Acesso não autorizado** | Token-Gating on-chain | Consulta em tempo real de saldo/NFT/roles na blockchain |

### P: "E se a chave privada for roubada?"

Esta é uma **limitação real** do modelo, e deve ser reconhecida com honestidade acadêmica:

- Se a chave privada for comprometida (malware, engenharia social), o atacante pode se passar pelo usuário.
- No modelo tradicional, o equivalente é o roubo de senha — com a diferença de que senhas podem ser "redefinidas" por uma autoridade central, enquanto chaves privadas não podem (são soberanas).
- **Mitigações existentes:** carteiras hardware (Ledger/Trezor), autenticação biométrica na carteira, MPC (Multi-Party Computation).
- **Mitigação no SDK:** mesmo com a chave roubada, o Token-Gating pode bloquear o acesso se o atacante não possuir os tokens necessários.

---

## 7. Aspectos Técnicos do SDK

### P: "Por que um SDK e não uma API centralizada?"

Uma API centralizada (servidor próprio que valida assinaturas) criaria um **Ponto Único de Falha (SPOF)**: se o servidor cair, ninguém consegue autenticar. Além disso, introduziria um intermediário central, contradizendo a proposta de descentralização.

O SDK é uma **biblioteca que o desenvolvedor instala no próprio projeto** (`npm install`). A verificação criptográfica roda dentro do servidor do desenvolvedor, sem dependência externa. Cada aplicação é autônoma.

### P: "Por que TypeScript/Node.js?"

Node.js é o ecossistema mais maduro para desenvolvimento Web3. A biblioteca `ethers.js` (padrão do mercado para interação com Ethereum) é nativa JavaScript/TypeScript. O SDK compila para **dois formatos** (CommonJS e ESM), sendo compatível com projetos JavaScript puros e TypeScript.

### P: "O que é o padrão EIP-4361?"

EIP-4361 (Ethereum Improvement Proposal 4361), também chamado **SIWE (Sign-In with Ethereum)**, é um padrão aberto publicado pela Ethereum Foundation que define o formato da mensagem de login. Ele garante que:
- A mensagem é **legível ao humano** (o usuário entende o que está assinando na MetaMask).
- Contém campos obrigatórios de segurança (domínio, nonce, timestamps).
- É **interoperável** entre aplicações — qualquer app que implemente EIP-4361 usa o mesmo formato.

---

## 8. Perguntas Adicionais que Podem Surgir

### P: "Qual a diferença do seu trabalho para o que já existe no mercado?"

Soluções como Web3Auth, Privy e Dynamic.xyz oferecem autenticação Web3, mas são **serviços SaaS proprietários e centralizados** (modelo Web 2.5). O SDK deste TCC é:
- **Open-source e gratuito** (licença MIT)
- **Sem dependência de serviços externos** (verificação local)
- **Educacional** — código documentado com JSDoc explicando cada algoritmo

### P: "O sistema foi testado?"

Sim, em dois níveis:
- **13 testes unitários automatizados** (Vitest) cobrindo: geração/consumo de nonces, expiração, normalização de endereços, verificação ECDSA válida, falsificação de identidade, replay attack, phishing por domínio, assinatura corrompida e parsing EIP-4361.
- **Testes de integração de ponta a ponta** com um simulador que reproduz o fluxo completo (incluindo Token-Gating contra a rede Ethereum real).

### P: "Quais são as limitações e trabalhos futuros?"

| Limitação | Trabalho Futuro |
|-----------|----------------|
| Segurança depende do dispositivo/carteira do usuário | Integração com MPC (Multi-Party Computation) |
| Sem SDK de frontend (client-side) | Criar `sdk-client-js` com abstração da MetaMask |
| Sem suporte a múltiplas blockchains | Estender para Polygon, Arbitrum, Solana |
| Token-Gating depende de RPC externo | Cache local de consultas on-chain |
| Sem revogação de sessão on-chain | Smart Contract para gerenciamento de sessões |
