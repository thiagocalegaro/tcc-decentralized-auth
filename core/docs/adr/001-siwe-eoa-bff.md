# ADR-001: SIWE para contas EOA com BFF e sessão opaca

Status: adotada no protótipo 0.1.0.

Data: 18 de setembro de 2026.

## Contexto

O TCC investiga autenticação com carteiras blockchain. A primeira implementação precisa permitir um login completo, oferecer uma integração que outro desenvolvedor consiga reproduzir e produzir evidências para a avaliação acadêmica.

O usuário prova controle de uma chave ao assinar uma mensagem. Essa prova não confirma nome civil, exclusividade da pessoa ou autorização para outras operações. Também não garante que o computador ou a carteira estejam livres de comprometimento.

A aplicação precisa de uma sessão após verificar a assinatura. O vínculo entre a prova, o navegador que iniciou o fluxo e o cliente que recebe a identidade exige tratamento próprio; uma assinatura válida, sozinha, não cria esse vínculo.

## Decisão

Usamos SIWE, conforme ERC-4361, como formato de mensagem, com assinatura `personal_sign`. A API gera o desafio e verifica a assinatura EOA por recuperação do endereço. O SDK assina os bytes da mensagem recebida após conferir domínio, URI, rede, conta, nonce e validade.

Adotamos TypeScript no monorepo npm. A interface usa React/Vite; API e BFF usam Fastify. A biblioteca viem fornece as funções Ethereum, SIWE e de recuperação de endereço. O pacote jose assina e verifica as asserções ES256.

O BFF atua como cliente confidencial. Ele guarda o segredo do cliente e o verificador PKCE S256. O navegador recebe o desafio PKCE, mas não recebe o verificador. O BFF associa o fluxo a um cookie HttpOnly e a um `flowId` aleatório antes de solicitar qualquer assinatura.

Depois de validar a assinatura, a API emite um código opaco de uso único. O navegador entrega esse código ao BFF junto ao `flowId`. O BFF confere o cookie e troca o código entre servidores, enviando seu segredo, o verificador PKCE e a URI registrada. A API confere esses vínculos antes de consumir o código.

A API devolve uma asserção JWT ES256. O BFF valida a assinatura via JWKS, o algoritmo, o emissor, a audiência, os tempos, o identificador `jti` e os campos da carteira. Depois cria uma sessão opaca com cookie HttpOnly. O navegador não precisa armazenar JWT ou segredo em `localStorage`.

O protocolo de integração é próprio. A presença de PKCE, código e JWT não torna esta versão um provedor OAuth 2.0 ou OpenID Connect. `redirectUri` vincula o fluxo à URI cadastrada; a demonstração não implementa um endpoint de autorização com redirecionamento OAuth.

## Limites e estado dos dados

| Elemento | Implementação e prazo |
| --- | --- |
| Carteiras | EOA; redes permitidas configuráveis, com `1` e `11155111` por padrão |
| Desafio SIWE | Cinco minutos; API armazena hashes da mensagem e do nonce |
| Código | 60 segundos; hash no armazenamento; consumo de uso único vinculado a cliente, URI e PKCE |
| Asserção | ES256, 60 segundos; entregue entre API e BFF |
| Fluxo do navegador | Cinco minutos; BFF guarda verificador e hash do cookie |
| Sessão | 30 minutos sem atividade, limite absoluto de oito horas; hash do token no BFF |
| Identidade | `eip155:<chainId>:<endereço-em-minúsculas>` |

O armazenamento da API pode usar memória ou PostgreSQL. A operação de consumir o desafio e registrar o código precisa ser atômica. A troca também precisa consumir o código uma vez, após conferir seus vínculos. O adaptador PostgreSQL implementa essas operações com transações e comandos condicionais.

O BFF desta entrega usa memória para fluxos, sessões e identificadores de asserções já utilizados. Reiniciar o processo invalida esses dados. Uma futura implementação persistente precisa preservar a atomicidade, os prazos e a possibilidade de cancelar um fluxo durante uma conclusão em andamento.

O ambiente local usa HTTP em loopback e a origem canônica `http://localhost:5173`. O BFF deriva a configuração de cookies seguros do modo de execução e da origem HTTPS. As restrições implementadas para produção não substituem uma avaliação de implantação; esta versão mantém limitações de processo único e de operação.

## Consequências

O usuário consegue autenticar sem saldo e sem transmitir uma transação. O projeto pode testar o fluxo EOA sem RPC. A integração preserva um formato de assinatura conhecido e mantém os segredos da aplicação no servidor.

A API e o BFF continuam como pontos de disponibilidade e confiança. O usuário controla a chave que produz a prova, enquanto os servidores decidem a aceitação dessa prova e administram o acesso. Essa é a extensão da descentralização demonstrada neste protótipo.

Um endereço público permite correlacionar acessos e atividade on-chain. O hash de endereço usado nos eventos de auditoria reduz a exposição direta, mas não anonimiza a conta. A documentação e o consentimento precisam tratar essa limitação.

O esquema de identidade inclui a rede. Autenticar o mesmo endereço na Mainnet e na Sepolia gera identificadores diferentes. Vincular redes ou carteiras a uma conta de usuário exige um fluxo futuro, com confirmação de posse e regras de recuperação.

## Alternativas consideradas

Um contrato no caminho do login exigiria decisões de rede, RPC, custo e operação sem necessidade para verificar uma assinatura EOA. Contratos ficam fora deste recorte inicial.

Uma integração SIWE direta em cada backend eliminaria a API central do protótipo e reduziria componentes. Mantivemos API e BFF separados para avaliar o serviço reutilizável e seu esforço de integração. O estudo deve medir esse custo adicional.

Entregar a asserção ao JavaScript do navegador aumentaria a superfície de exposição e exigiria outro tratamento de sessão. Escolhemos a troca entre servidores e o cookie opaco para a aplicação demonstradora.

ERC-1271 amplia a compatibilidade com carteiras de contrato, mas precisa de consulta à rede e de uma política para mudanças de validade. O suporte fica para uma segunda etapa, com testes e modelo de ameaças próprios.

## Verificação e próximos passos

Os testes cobrem validação SIWE, repetições e concorrência, vínculos de cliente e origem, PKCE, asserções e ciclo de sessão. Consulte [VALIDACAO.md](../VALIDACAO.md) para os resultados observados. Os testes locais em memória não comprovam o comportamento do PostgreSQL real; a suíte SQL exige `TEST_DATABASE_URL` e o CI provisiona um serviço para esse fim.

Antes de estudar integração com múltiplas instâncias, implemente o armazenamento persistente do BFF e a coordenação dos limites de requisições. Depois, avalie ERC-1271, rotação da chave ES256 e recuperação de conta. Para o TCC, registre os cenários, a versão das carteiras e as métricas de conclusão, tempo e erros sem coletar chaves, assinaturas ou tokens de sessão.

## Referências

- [ERC-4361: Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361)
- [EIP-1193: Ethereum Provider JavaScript API](https://eips.ethereum.org/EIPS/eip-1193)
- [EIP-6963: Multi Injected Provider Discovery](https://eips.ethereum.org/EIPS/eip-6963)
- [RFC 7636: Proof Key for Code Exchange](https://www.rfc-editor.org/rfc/rfc7636)
- [ERC-1271: Standard Signature Validation Method for Contracts](https://eips.ethereum.org/EIPS/eip-1271)
