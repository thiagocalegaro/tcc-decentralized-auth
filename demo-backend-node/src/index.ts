import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { getAddress } from 'ethers';
import { MemoryNonceStore, SiweVerifier, SiweMessage, BlockchainVerifier } from '@tcc-auth/sdk-server-node';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const domain = process.env.DOMAIN || 'localhost:3000';
const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-key';
const rpcUrl = process.env.RPC_URL || 'https://cloudflare-eth.com';
const tokenAddress = process.env.TOKEN_ADDRESS || '0x514910771AF9Ca656af840dff83E8264EcF986CA'; // Chainlink por padrão
const minBalance = parseFloat(process.env.MIN_BALANCE || '1.0');

app.use(cors());
app.use(express.json());

// Instanciar o NonceStore e o Verifier do SDK
const nonceStore = new MemoryNonceStore(5 * 60 * 1000);
const verifier = new SiweVerifier(domain, nonceStore);

// Instanciar o validador de blockchain do SDK (Fase 2)
const blockchainVerifier = new BlockchainVerifier(rpcUrl);

interface AuthenticatedRequest extends Request {
  userAddress?: string;
}

// Middleware de verificação de sessão (JWT)
const authenticateJwt = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Token de autenticação não fornecido.' });
  }

  jwt.verify(token, jwtSecret, (err, decoded: any) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Token inválido ou expirado.' });
    }
    req.userAddress = decoded.address;
    next();
  });
};

/**
 * Endpoint 1: Solicita o desafio de login (desafio/nonce)
 * GET /api/auth/challenge?address=0x...
 */
app.get('/api/auth/challenge', async (req: Request, res: Response) => {
  const addressParam = req.query.address as string;

  if (!addressParam) {
    return res.status(400).json({ success: false, error: 'O parâmetro address é obrigatório.' });
  }

  try {
    const formattedAddress = getAddress(addressParam);

    // 1. Gera o nonce utilizando nossa biblioteca (Chamada assíncrona)
    const nonce = await nonceStore.generate(formattedAddress);

    // 2. Monta a mensagem de desafio no padrão EIP-4361
    const siweMessageParams: SiweMessage = {
      domain,
      address: formattedAddress,
      statement: 'Assine esta mensagem para provar que você é dono da chave privada deste endereço. Sem taxas de gás.',
      uri: `http://${domain}/login`,
      version: '1',
      chainId: 1,
      nonce,
      issuedAt: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    };

    const messageText = SiweVerifier.createMessage(siweMessageParams);

    return res.json({
      success: true,
      message: messageText,
      nonce
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: 'Endereço Ethereum inválido.' });
  }
});

/**
 * Endpoint 2: Verifica a assinatura e emite a sessão (JWT)
 * POST /api/auth/verify
 * Body: { message, signature, address, gated?: boolean }
 */
app.post('/api/auth/verify', async (req: Request, res: Response) => {
  const { message, signature, address, gated } = req.body;

  if (!message || !signature || !address) {
    return res.status(400).json({
      success: false,
      error: 'Parâmetros ausentes no corpo da requisição: message, signature, address são obrigatórios.'
    });
  }

  // 1. Utiliza o verificador da nossa biblioteca para validar a assinatura criptográfica
  const result = await verifier.verify(message, signature, address);

  if (!result.success || !result.address) {
    return res.status(401).json({
      success: false,
      error: result.message || 'Falha na verificação da assinatura.'
    });
  }

  // 2. Validação On-Chain / Token-Gating (Fase 2)
  if (gated) {
    try {
      console.log(`[Blockchain RPC] Verificando saldo do token ${tokenAddress} para o endereço ${result.address}...`);
      const hasMinimumBalance = await blockchainVerifier.checkERC20Balance(
        result.address,
        tokenAddress,
        minBalance
      );

      if (!hasMinimumBalance) {
        return res.status(403).json({
          success: false,
          error: `Acesso negado por Token-Gating: você precisa de pelo menos ${minBalance} tokens no endereço ${tokenAddress} para autenticar.`
        });
      }
      console.log(`[Blockchain RPC] Saldo do token validado com sucesso!`);
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: `Erro ao validar saldo na blockchain: ${err.message || err}`
      });
    }
  }

  // 3. Autenticação bem-sucedida! Emitir o token JWT de sessão
  const token = jwt.sign(
    { address: result.address },
    jwtSecret,
    { expiresIn: '1h' }
  );

  return res.json({
    success: true,
    message: gated ? 'Autenticação com Token-Gating bem-sucedida.' : 'Autenticação bem-sucedida.',
    token,
    address: result.address
  });
});

/**
 * Endpoint Protegido: Simula acesso a dados sensíveis pós-login
 * GET /api/user/profile
 */
app.get('/api/user/profile', authenticateJwt, (req: AuthenticatedRequest, res: Response) => {
  return res.json({
    success: true,
    message: 'Acesso autorizado a rota protegida.',
    userAddress: req.userAddress,
    description: 'Estes dados só podem ser vistos porque a assinatura criptográfica da blockchain foi verificada com sucesso offline por nossa biblioteca, emitindo um token JWT válido.'
  });
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
