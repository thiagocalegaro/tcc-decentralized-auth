/**
 * @module @tcc-auth/sdk-server-node
 * @description
 * SDK server-side para autenticação descentralizada baseada em blockchain.
 *
 * Implementa o padrão **EIP-4361 (Sign-In with Ethereum / SIWE)** para autenticar
 * usuários usando assinaturas criptográficas ECDSA em vez de senhas armazenadas.
 *
 * @example
 * ```typescript
 * import { MemoryNonceStore, SiweVerifier } from '@tcc-auth/sdk-server-node';
 *
 * const store = new MemoryNonceStore();
 * const verifier = new SiweVerifier('meudominio.com', store);
 *
 * const nonce = await store.generate('0xABCD...');
 * const result = await verifier.verify(message, signature, '0xABCD...');
 * ```
 */

/**
 * Representa uma mensagem de login estruturada no padrão EIP-4361 (SIWE).
 * @see {@link https://eips.ethereum.org/EIPS/eip-4361}
 */
export interface SiweMessage {
  /** Domínio da aplicação solicitante (ex: "meuapp.com" ou "localhost:3000") */
  domain: string;

  /** Endereço Ethereum do usuário no formato EIP-55 (checksummed) */
  address: string;

  /** Declaração legível ao humano sobre a intenção do login (opcional) */
  statement?: string;

  /** URI da aplicação (ex: "https://meuapp.com/login") */
  uri: string;

  /** Versão do padrão SIWE. Deve ser "1" */
  version: string;

  /** Chain ID da rede Ethereum (1 = Mainnet, 11155111 = Sepolia, etc.) */
  chainId: number;

  /** Identificador único e aleatório gerado pelo servidor para prevenir replay attacks */
  nonce: string;

  /** Data e hora de emissão da mensagem em formato ISO 8601 */
  issuedAt: string;

  /** Data e hora de expiração da mensagem em formato ISO 8601 (opcional) */
  expirationTime?: string;

  /** Data e hora a partir da qual a mensagem é válida em formato ISO 8601 (opcional) */
  notBefore?: string;

  /** Identificador de requisição definido pela aplicação (opcional) */
  requestId?: string;

  /** Lista de URIs de recursos que a aplicação deseja acessar (opcional) */
  resources?: string[];
}

/**
 * Resultado retornado após a verificação de uma assinatura EIP-4361.
 */
export interface VerificationResult {
  /** Indica se a verificação foi bem-sucedida */
  success: boolean;

  /** Mensagem descritiva do resultado (erro ou sucesso) */
  message?: string;

  /**
   * Endereço Ethereum verificado criptograficamente do usuário autenticado.
   * Presente somente quando `success` é `true`.
   */
  address?: string;
}
