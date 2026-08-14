import crypto from 'crypto';

/**
 * Interface mínima que qualquer cliente Redis compatível deve implementar.
 * Desacopla o SDK de uma implementação específica de cliente Redis.
 */
export interface RedisLikeClient {
  /** Armazena um valor com opções de expiração (PX = milissegundos) */
  set(key: string, value: string, options?: { PX?: number }): Promise<unknown>;
  /** Recupera o valor associado à chave, ou `null` se não existir */
  get(key: string): Promise<string | null>;
  /** Remove a chave do banco */
  del(key: string | string[]): Promise<number>;
}
/**
 * Interface para implementações de armazenamento e validação de nonces de autenticação.
 *
 * Um nonce (number used once) é um valor aleatório gerado pelo servidor que deve ser
 * assinado pelo usuário. Após ser verificado uma única vez, é descartado para prevenir
 * ataques de replay (reutilização de assinaturas interceptadas).
 *
 * @example Implementação customizada (ex: PostgreSQL)
 * ```typescript
 * class PostgresNonceStore implements NonceStore {
 *   async generate(address: string, ttlMs = 300000): Promise<string> {
 *     const nonce = crypto.randomBytes(16).toString('hex');
 *     await db.query(
 *       'INSERT INTO nonces (address, nonce, expires_at) VALUES ($1, $2, $3)',
 *       [address.toLowerCase(), nonce, new Date(Date.now() + ttlMs)]
 *     );
 *     return nonce;
 *   }
 *
 *   async verify(address: string, nonce: string): Promise<boolean> {
 *     const result = await db.query(
 *       'DELETE FROM nonces WHERE address = $1 AND nonce = $2 AND expires_at > NOW() RETURNING id',
 *       [address.toLowerCase(), nonce]
 *     );
 *     return result.rowCount > 0;
 *   }
 * }
 * ```
 */
export interface NonceStore {
  /**
   * Gera um nonce criptograficamente seguro e o armazena associado ao endereço.
   * @param address - Endereço Ethereum do usuário (será normalizado para lowercase internamente)
   * @param ttlMs - Tempo de vida do nonce em milissegundos (padrão definido pela implementação)
   * @returns Promise com o nonce gerado em formato hexadecimal
   */
  generate(address: string, ttlMs?: number): Promise<string>;

  /**
   * Verifica se o nonce é válido para o endereço e o consome (invalida) para prevenir replay attacks.
   * Esta operação deve ser **atômica**: verificar e deletar o nonce numa única operação.
   * @param address - Endereço Ethereum do usuário
   * @param nonce - Nonce a ser verificado
   * @returns Promise com `true` se o nonce é válido e não expirou, `false` caso contrário
   */
  verify(address: string, nonce: string): Promise<boolean>;
}

/**
 * Implementação de `NonceStore` com armazenamento em memória RAM.
 *
 * **Ideal para:** Desenvolvimento local, testes unitários e ambientes com **um único servidor**.
 *
 * **Atenção:** Em ambientes com múltiplos servidores (ex: load balancer), utilize
 * `RedisNonceStore` para compartilhar o estado entre as instâncias.
 *
 * @example
 * ```typescript
 * // Nonces expiram após 5 minutos (padrão)
 * const store = new MemoryNonceStore();
 *
 * // Ou com TTL personalizado (ex: 2 minutos)
 * const store = new MemoryNonceStore(2 * 60 * 1000);
 * ```
 */
export class MemoryNonceStore implements NonceStore {
  private store: Map<string, { nonce: string; expiresAt: number }> = new Map();

  /**
   * @param defaultTtlMs - Tempo de vida padrão dos nonces em ms. Default: 300000 (5 minutos)
   */
  constructor(private defaultTtlMs: number = 5 * 60 * 1000) {}

  /**
   * Gera um nonce hexadecimal de 16 bytes e o armazena em memória com expiração.
   * Sobrescreve qualquer nonce anterior para o mesmo endereço.
   */
  async generate(address: string, ttlMs: number = this.defaultTtlMs): Promise<string> {
    const nonce = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + ttlMs;

    this.store.set(address.toLowerCase(), { nonce, expiresAt });
    return nonce;
  }

  /**
   * Verifica o nonce e o remove da memória para prevenir reutilização.
   * Retorna `false` imediatamente se o nonce não existir ou já tiver expirado.
   */
  async verify(address: string, nonce: string): Promise<boolean> {
    const key = address.toLowerCase();
    const stored = this.store.get(key);

    if (!stored) {
      return false;
    }

    if (Date.now() > stored.expiresAt) {
      this.store.delete(key);
      return false;
    }

    if (stored.nonce !== nonce) {
      return false;
    }

    // Consumir o nonce: deletar após a primeira verificação bem-sucedida
    this.store.delete(key);
    return true;
  }

  /**
   * Remove todos os registros de nonces expirados da memória.
   * Pode ser chamado periodicamente para evitar acúmulo de dados obsoletos.
   * @example
   * ```typescript
   * // Executar limpeza a cada 10 minutos
   * setInterval(() => store.cleanUp(), 10 * 60 * 1000);
   * ```
   */
  cleanUp(): void {
    const now = Date.now();
    for (const [key, value] of this.store.entries()) {
      if (now > value.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * Implementação de `NonceStore` com armazenamento no Redis.
 *
 * **Ideal para:** Ambientes de **produção** com múltiplos servidores, microserviços
 * ou deployments serverless (AWS Lambda, Vercel, Railway).
 *
 * O Redis gerencia o TTL nativamente, eliminando a necessidade de limpeza manual.
 * A operação de verificação utiliza `GET` seguido de `DEL` para garantir atomicidade.
 *
 * @example
 * ```typescript
 * import { createClient } from 'redis';
 * import { RedisNonceStore } from '@tcc-auth/sdk-server-node';
 *
 * const client = createClient({ url: process.env.REDIS_URL });
 * await client.connect();
 *
 * const store = new RedisNonceStore(client, 5 * 60 * 1000);
 * ```
 */
export class RedisNonceStore implements NonceStore {
  /**
   * @param redisClient - Instância ativa e conectada do cliente Redis v4 (`redis` package)
   * @param defaultTtlMs - Tempo de vida padrão dos nonces em ms. Default: 300000 (5 minutos)
   */
  constructor(
    private redisClient: RedisLikeClient,
    private defaultTtlMs: number = 5 * 60 * 1000
  ) {}

  /**
   * Gera e armazena um nonce no Redis com tempo de expiração automático (TTL).
   * Chave armazenada no formato: `siwe:nonce:<address_lowercase>`
   */
  async generate(address: string, ttlMs: number = this.defaultTtlMs): Promise<string> {
    const nonce = crypto.randomBytes(16).toString('hex');
    const key = `siwe:nonce:${address.toLowerCase()}`;

    // Armazenamento atômico com expiração em milissegundos via flag PX
    await this.redisClient.set(key, nonce, { PX: ttlMs });

    return nonce;
  }

  /**
   * Verifica o nonce no Redis e o deleta atomicamente para prevenir replay attacks.
   * Se o nonce não existir (expirado ou já utilizado), retorna `false`.
   */
  async verify(address: string, nonce: string): Promise<boolean> {
    const key = `siwe:nonce:${address.toLowerCase()}`;
    const storedNonce = await this.redisClient.get(key);

    if (!storedNonce || storedNonce !== nonce) {
      return false;
    }

    // Consumir o nonce: deletar após a primeira verificação bem-sucedida
    await this.redisClient.del(key);
    return true;
  }
}
