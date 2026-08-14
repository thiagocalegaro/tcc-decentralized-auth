import { Contract, Provider, JsonRpcProvider, formatUnits } from 'ethers';

// ABI mínima necessária para consultar saldo ERC-20
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

// ABI mínima necessária para consultar posse ERC-721 (NFT)
const ERC721_ABI = [
  'function balanceOf(address owner) view returns (uint256)'
];

// ABI para verificar controle de acesso padronizado (OpenZeppelin AccessControl)
const ACCESS_CONTROL_ABI = [
  'function hasRole(bytes32 role, address account) view returns (bool)'
];

/**
 * Utilitários para consultas on-chain via RPC da rede Ethereum (ou compatíveis com EVM).
 *
 * Permite implementar **políticas de acesso baseadas em ativos da blockchain**, como:
 * - **Token-Gating**: Exigir saldo mínimo de um token ERC-20 para fazer login
 * - **NFT-Gating**: Exigir posse de pelo menos um NFT de uma coleção ERC-721
 * - **Role-Based Access Control (RBAC) On-chain**: Verificar permissões definidas em Smart Contracts
 *
 * Todas as consultas são **somente leitura** (não geram transações ou custos de gas).
 *
 * @example
 * ```typescript
 * import { BlockchainVerifier } from '@tcc-auth/sdk-server-node';
 *
 * // Conectar via nó RPC público (Infura, Alchemy, PublicNode, etc.)
 * const blockchain = new BlockchainVerifier('https://ethereum-rpc.publicnode.com');
 *
 * // Verificar saldo antes de liberar o login
 * const hasEnoughTokens = await blockchain.checkERC20Balance(
 *   userAddress,
 *   '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK token
 *   1.0
 * );
 * ```
 */
export class BlockchainVerifier {
  private provider: Provider;

  /**
   * @param rpcUrl - URL do nó de conexão com a blockchain.
   *   Exemplos de provedores públicos gratuitos:
   *   - Ethereum Mainnet: `https://ethereum-rpc.publicnode.com`
   *   - Sepolia Testnet: `https://ethereum-sepolia-rpc.publicnode.com`
   *   - Hardhat local: `http://127.0.0.1:8545`
   *   - Anvil local: `http://127.0.0.1:8545`
   */
  constructor(rpcUrl: string) {
    this.provider = new JsonRpcProvider(rpcUrl);
  }

  /**
   * Retorna a instância do provider `ethers.js` para consultas customizadas.
   * Útil para interagir com contratos que não possuem métodos utilitários neste SDK.
   *
   * @returns Provider configurado para a rede definida no construtor
   */
  public getProvider(): Provider {
    return this.provider;
  }

  /**
   * Verifica se um endereço possui saldo mínimo de um token ERC-20 (**Token-Gating**).
   *
   * Realiza duas chamadas de leitura ao Smart Contract do token:
   * 1. `balanceOf(address)` para obter o saldo bruto (em unidades menores, ex: wei)
   * 2. `decimals()` para converter corretamente para unidades legíveis (ex: 1.5 LINK)
   *
   * @param userAddress - Endereço Ethereum do usuário a ser verificado
   * @param tokenAddress - Endereço do contrato do token ERC-20 na blockchain
   * @param minBalance - Saldo mínimo necessário em unidades decimais legíveis (ex: `1.5` para 1.5 tokens)
   * @returns `Promise<boolean>` — `true` se o saldo for maior ou igual ao mínimo
   *
   * @example
   * ```typescript
   * // Exigir ao menos 100 USDC (6 decimais) para logar
   * const hasAccess = await blockchain.checkERC20Balance(
   *   userAddress,
   *   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
   *   100.0
   * );
   * ```
   */
  async checkERC20Balance(
    userAddress: string,
    tokenAddress: string,
    minBalance: number
  ): Promise<boolean> {
    try {
      const contract = new Contract(tokenAddress, ERC20_ABI, this.provider);
      const balance: bigint = await contract.balanceOf(userAddress);
      const decimals = await contract.decimals();

      // Utilizar formatUnits do ethers v6 para converter BigInt com decimais corretamente
      const formattedBalance = parseFloat(formatUnits(balance, decimals));
      return formattedBalance >= minBalance;
    } catch (error: any) {
      throw new Error(`Falha ao ler saldo ERC-20 na blockchain: ${error.message || error}`);
    }
  }

  /**
   * Verifica se um endereço possui pelo menos um NFT de uma coleção ERC-721 (**NFT-Gating**).
   *
   * @param userAddress - Endereço Ethereum do usuário a ser verificado
   * @param nftContractAddress - Endereço do contrato da coleção NFT
   * @returns `Promise<boolean>` — `true` se o usuário possuir ao menos 1 NFT da coleção
   *
   * @example
   * ```typescript
   * // Verificar posse de qualquer NFT do Bored Ape Yacht Club
   * const isHolder = await blockchain.checkERC721Ownership(
   *   userAddress,
   *   '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D' // BAYC
   * );
   * ```
   */
  async checkERC721Ownership(
    userAddress: string,
    nftContractAddress: string
  ): Promise<boolean> {
    try {
      const contract = new Contract(nftContractAddress, ERC721_ABI, this.provider);
      const balance: bigint = await contract.balanceOf(userAddress);
      return balance > 0n;
    } catch (error: any) {
      throw new Error(`Falha ao ler posse de NFT na blockchain: ${error.message || error}`);
    }
  }

  /**
   * Verifica permissões (Roles) on-chain no padrão **AccessControl da OpenZeppelin**.
   *
   * O padrão AccessControl permite que contratos inteligentes definam papéis (roles)
   * e atribuam-nos a endereços Ethereum. Isso cria um sistema de controle de acesso
   * totalmente imutável e auditável na blockchain.
   *
   * @param userAddress - Endereço Ethereum do usuário a ser verificado
   * @param aclContractAddress - Endereço do contrato que implementa AccessControl
   * @param roleHash - Hash bytes32 do papel (role). Calculado como `keccak256(toUtf8Bytes('NOME_DO_ROLE'))`
   * @returns `Promise<boolean>` — `true` se o usuário possuir o papel especificado
   *
   * @example
   * ```typescript
   * import { keccak256, toUtf8Bytes } from 'ethers';
   *
   * const ADMIN_ROLE = keccak256(toUtf8Bytes('ADMIN_ROLE'));
   * const EDITOR_ROLE = keccak256(toUtf8Bytes('EDITOR_ROLE'));
   *
   * const isAdmin = await blockchain.checkRole(userAddress, contractAddress, ADMIN_ROLE);
   * ```
   */
  async checkRole(
    userAddress: string,
    aclContractAddress: string,
    roleHash: string
  ): Promise<boolean> {
    try {
      const contract = new Contract(aclContractAddress, ACCESS_CONTROL_ABI, this.provider);
      const hasRole: boolean = await contract.hasRole(roleHash, userAddress);
      return hasRole;
    } catch (error: any) {
      throw new Error(`Falha ao verificar role on-chain: ${error.message || error}`);
    }
  }
}
