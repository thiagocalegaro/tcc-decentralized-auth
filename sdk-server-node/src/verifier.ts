import { verifyMessage, getAddress } from 'ethers';
import { SiweMessage, VerificationResult } from './types';
import { NonceStore } from './nonce';

/**
 * Verificador de assinaturas criptográficas no padrão **EIP-4361 (Sign-In with Ethereum / SIWE)**.
 *
 * Realiza a verificação completa de uma mensagem de login descentralizada:
 * 1. **Verificação ECDSA:** Recupera o endereço Ethereum da assinatura usando curvas elípticas
 *    (secp256k1) e confirma que coincide com o endereço declarado pelo cliente.
 * 2. **Validação de Domínio:** Protege contra phishing verificando que a mensagem foi
 *    assinada para o domínio correto.
 * 3. **Validação de Nonce:** Confirma que o nonce foi gerado por este servidor, consome-o
 *    e bloqueia reutilização para prevenir replay attacks.
 * 4. **Validação de Expiração:** Rejeita mensagens cujo tempo de validade já passou.
 *
 * @example
 * ```typescript
 * import { MemoryNonceStore, SiweVerifier } from '@tcc-auth/sdk-server-node';
 *
 * const nonceStore = new MemoryNonceStore();
 * const verifier = new SiweVerifier('meuapp.com', nonceStore);
 *
 * // Gerar desafio
 * const nonce = await nonceStore.generate(userAddress);
 * const message = SiweVerifier.createMessage({ domain: 'meuapp.com', address: userAddress, nonce, ... });
 *
 * // Verificar assinatura retornada pelo cliente
 * const result = await verifier.verify(message, signature, userAddress);
 * if (result.success) {
 *   console.log('Usuário autenticado:', result.address);
 * }
 * ```
 */
export class SiweVerifier {
  /**
   * @param expectedDomain - Domínio da aplicação (ex: "meuapp.com"). Mensagens assinadas
   *   para outros domínios serão rejeitadas para proteger contra ataques de phishing.
   * @param nonceStore - Implementação de armazenamento de nonces. Se omitido, a
   *   validação de nonce será ignorada (não recomendado em produção).
   */
  constructor(
    private expectedDomain: string,
    private nonceStore?: NonceStore
  ) {}

  /**
   * Transforma uma string de mensagem EIP-4361 em um objeto estruturado.
   *
   * @param messageText - String da mensagem no formato EIP-4361
   * @returns Objeto com os campos extraídos. Campos ausentes na mensagem não estarão presentes.
   */
  public parseMessage(messageText: string): Partial<SiweMessage> {
    const lines = messageText.split('\n');
    const parsed: Partial<SiweMessage> = {};

    try {
      const headerRegex = /^([^ ]+) wants you to sign in with your Ethereum account:$/;
      const headerMatch = lines[0]?.match(headerRegex);
      if (headerMatch) {
        parsed.domain = headerMatch[1];
      }

      const addressLine = lines[2]?.trim();
      if (addressLine && addressLine.startsWith('0x')) {
        parsed.address = addressLine;
      }

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('URI:')) {
          parsed.uri = trimmed.substring(4).trim();
        } else if (trimmed.startsWith('Version:')) {
          parsed.version = trimmed.substring(8).trim();
        } else if (trimmed.startsWith('Chain ID:')) {
          parsed.chainId = parseInt(trimmed.substring(9).trim(), 10);
        } else if (trimmed.startsWith('Nonce:')) {
          parsed.nonce = trimmed.substring(6).trim();
        } else if (trimmed.startsWith('Issued At:')) {
          parsed.issuedAt = trimmed.substring(10).trim();
        } else if (trimmed.startsWith('Expiration Time:')) {
          parsed.expirationTime = trimmed.substring(16).trim();
        } else if (trimmed.startsWith('Not Before:')) {
          parsed.notBefore = trimmed.substring(11).trim();
        } else if (trimmed.startsWith('Request ID:')) {
          parsed.requestId = trimmed.substring(11).trim();
        }
      }
    } catch (e) {
      // Retorna o que foi possível parsear
    }

    return parsed;
  }

  /**
   * Verifica uma assinatura EIP-4361 de forma completa e segura.
   *
   * O processo de verificação ECDSA consiste em:
   * - Aplicar a função de hash Keccak-256 sobre a mensagem prefixada com `\x19Ethereum Signed Message:\n`
   * - Recuperar o ponto na curva elíptica secp256k1 correspondente à assinatura
   * - Derivar o endereço Ethereum (últimos 20 bytes do hash Keccak-256 da chave pública)
   * - Comparar com o endereço declarado pelo usuário
   *
   * @param messageText - Mensagem original no formato EIP-4361 (a mesma que o usuário assinou)
   * @param signature - Assinatura criptográfica gerada pela carteira do usuário (formato hex)
   * @param claimedAddress - Endereço Ethereum que o cliente alega ter assinado a mensagem
   * @returns `Promise<VerificationResult>` com o resultado e o endereço verificado (se bem-sucedido)
   */
  public async verify(
    messageText: string,
    signature: string,
    claimedAddress: string
  ): Promise<VerificationResult> {
    try {
      // 1. Recuperação criptográfica do endereço a partir da assinatura (ECDSA ecrecover)
      const signerAddress = verifyMessage(messageText, signature);

      const normalizedSigner = getAddress(signerAddress);
      const normalizedClaimed = getAddress(claimedAddress);

      if (normalizedSigner !== normalizedClaimed) {
        return {
          success: false,
          message: 'A assinatura criptográfica não coincide com o endereço informado.'
        };
      }

      // 2. Validação do conteúdo da mensagem
      const parsed = this.parseMessage(messageText);

      // Proteção contra phishing: rejeitar mensagens assinadas para outros domínios
      if (!parsed.domain || parsed.domain.toLowerCase() !== this.expectedDomain.toLowerCase()) {
        return {
          success: false,
          message: `Domínio inválido. Esperado: ${this.expectedDomain}, obtido: ${parsed.domain}`
        };
      }

      // Proteção contra replay attacks: verificar e consumir o nonce
      if (this.nonceStore) {
        if (!parsed.nonce) {
          return {
            success: false,
            message: 'A mensagem assinalada não contém um Nonce.'
          };
        }
        const isNonceValid = await this.nonceStore.verify(normalizedClaimed, parsed.nonce);
        if (!isNonceValid) {
          return {
            success: false,
            message: 'Nonce inválido, expirado ou já utilizado.'
          };
        }
      }

      // Validação do tempo de expiração da mensagem
      if (parsed.expirationTime) {
        const expirationDate = new Date(parsed.expirationTime);
        if (isNaN(expirationDate.getTime()) || Date.now() > expirationDate.getTime()) {
          return {
            success: false,
            message: 'A mensagem de autenticação expirou.'
          };
        }
      }

      // Validação do tempo de início de validade
      if (parsed.notBefore) {
        const notBeforeDate = new Date(parsed.notBefore);
        if (isNaN(notBeforeDate.getTime()) || Date.now() < notBeforeDate.getTime()) {
          return {
            success: false,
            message: 'A validade desta mensagem ainda não iniciou.'
          };
        }
      }

      return {
        success: true,
        address: normalizedClaimed
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Falha na verificação da assinatura: ${error.message || error}`
      };
    }
  }

  /**
   * Formata uma string de mensagem válida no padrão **EIP-4361 (SIWE)**.
   *
   * A mensagem gerada deve ser enviada ao cliente para ser assinada pela carteira
   * do usuário (ex: MetaMask via `personal_sign`).
   *
   * @param params - Parâmetros da mensagem conforme a interface `SiweMessage`
   * @returns String formatada pronta para ser exibida ao usuário e assinada
   *
   * @example
   * ```typescript
   * const message = SiweVerifier.createMessage({
   *   domain: 'meuapp.com',
   *   address: '0xABCD...',
   *   uri: 'https://meuapp.com/login',
   *   version: '1',
   *   chainId: 1,
   *   nonce: 'abc123',
   *   issuedAt: new Date().toISOString(),
   *   statement: 'Faça login sem senha.'
   * });
   * ```
   */
  public static createMessage(params: SiweMessage): string {
    const header = `${params.domain} wants you to sign in with your Ethereum account:`;
    const address = getAddress(params.address);
    const body = `${header}\n${address}\n`;

    let meta = '';
    if (params.statement) {
      meta += `\n${params.statement}\n`;
    }
    meta += `\nURI: ${params.uri}`;
    meta += `\nVersion: ${params.version}`;
    meta += `\nChain ID: ${params.chainId}`;
    meta += `\nNonce: ${params.nonce}`;
    meta += `\nIssued At: ${params.issuedAt}`;
    if (params.expirationTime) {
      meta += `\nExpiration Time: ${params.expirationTime}`;
    }
    if (params.notBefore) {
      meta += `\nNot Before: ${params.notBefore}`;
    }
    if (params.requestId) {
      meta += `\nRequest ID: ${params.requestId}`;
    }
    if (params.resources && params.resources.length > 0) {
      meta += '\nResources:';
      for (const res of params.resources) {
        meta += `\n- ${res}`;
      }
    }

    return body + meta;
  }
}
