import { Wallet } from 'ethers';

const API_URL = 'http://127.0.0.1:3000/api';

async function runTests() {
  console.log('==================================================');
  console.log('INICIANDO SIMULADOR DE AUTENTICAÇÃO DESCENTRALIZADA');
  console.log('==================================================\n');

  // 1. Gerar uma carteira Ethereum de teste temporária (Simula a MetaMask)
  const wallet = Wallet.createRandom();
  const address = wallet.address;
  console.log(`[Passo 1] Carteira gerada com sucesso!`);
  console.log(` - Endereço Público: ${address}`);
  console.log(` - Chave Privada: ${wallet.privateKey}\n`);

  // 2. Solicitar o desafio de login (Nonce EIP-4361) ao backend
  console.log(`[Passo 2] Solicitando desafio para o endereço no backend...`);
  const challengeUrl = `${API_URL}/auth/challenge?address=${address}`;
  
  const challengeRes = await fetch(challengeUrl);
  const challengeData: any = await challengeRes.json();
  
  if (!challengeData.success) {
    throw new Error(`Falha ao obter desafio: ${challengeData.error}`);
  }
  
  const messageText = challengeData.message;
  console.log(` - Desafio Recebido do Servidor (Formato SIWE / EIP-4361):`);
  console.log('--------------------------------------------------');
  console.log(messageText);
  console.log('--------------------------------------------------\n');

  // 3. Assinar a mensagem com a chave privada (Simula a assinatura na MetaMask)
  console.log(`[Passo 3] Assinando o desafio com a chave privada do usuário (Offline/ECDSA)...`);
  const signature = await wallet.signMessage(messageText);
  console.log(` - Assinatura gerada (Hex): ${signature}\n`);

  // 4. Enviar a assinatura para verificação no backend (Fluxo sem Gating)
  console.log(`[Passo 4] Enviando assinatura e mensagem para verificação no endpoint POST /api/auth/verify (Sem Token-Gating)...`);
  const verifyRes = await fetch(`${API_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: messageText,
      signature: signature,
      address: address
    })
  });
  
  const verifyData: any = await verifyRes.json();
  console.log(` - Resposta do Servidor:`, verifyData);
  
  if (!verifyData.success) {
    throw new Error(`Falha no login: ${verifyData.error}`);
  }
  
  const token = verifyData.token;
  console.log(` - Token JWT Recebido com Sucesso!\n`);

  // 5. Testar o acesso a uma rota protegida usando o JWT de sessão
  console.log(`[Passo 5] Testando acesso a recurso protegido enviando o JWT recebido...`);
  const profileRes = await fetch(`${API_URL}/user/profile`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const profileData = await profileRes.json();
  console.log(` - Resposta da Rota Protegida /api/user/profile:`, profileData);
  console.log(`\n==================================================`);
  console.log('TESTES DE AUTENTICAÇÃO BEM-SUCEDIDA CONCLUÍDOS');
  console.log('==================================================\n');

  // 6. Testes de Segurança (Garantindo que o backend rejeita fraudes e valida token-gating)
  console.log('==================================================');
  console.log('INICIANDO TESTES DE SEGURANÇA E RESILIÊNCIA');
  console.log('==================================================\n');

  // Teste A: Replay Attack (Tentar usar a mesma assinatura uma segunda vez)
  console.log(`[Teste A] Tentando ataque de replay (enviar a mesma assinatura novamente)...`);
  const replayRes = await fetch(`${API_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: messageText,
      signature: signature,
      address: address
    })
  });
  const replayData: any = await replayRes.json();
  console.log(` - Resultado do Replay (Deve falhar): success = ${replayData.success}, erro = "${replayData.error}"`);
  if (replayData.success) {
    console.error('❌ FALHA DE SEGURANÇA: Servidor aceitou o mesmo nonce duas vezes!');
  } else {
    console.log('✅ SUCESSO: O servidor detectou e impediu o ataque de replay.');
  }
  console.log('');

  // Teste B: Endereço Adulterado (Um endereço tenta enviar a assinatura de outro)
  console.log(`[Teste B] Tentando falsificar identidade (enviar assinatura válida com outro endereço)...`);
  const maliciousWallet = Wallet.createRandom();
  const forgeryRes = await fetch(`${API_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: messageText,
      signature: signature,
      address: maliciousWallet.address
    })
  });
  const forgeryData: any = await forgeryRes.json();
  console.log(` - Resultado da Falsificação (Deve falhar): success = ${forgeryData.success}, erro = "${forgeryData.error}"`);
  if (forgeryData.success) {
    console.error('❌ FALHA DE SEGURANÇA: Servidor aceitou assinatura de outra carteira!');
  } else {
    console.log('✅ SUCESSO: O servidor detectou a divergência criptográfica.');
  }
  console.log('');

  // Teste C: Token-Gating (Validação de saldo on-chain via RPC)
  console.log(`[Teste C] Testando Token-Gating (tentar login exigindo saldo de token on-chain)...`);
  // Precisamos de um novo desafio para o novo teste de login
  const challengeUrl2 = `${API_URL}/auth/challenge?address=${address}`;
  const challengeRes2 = await fetch(challengeUrl2);
  const challengeData2: any = await challengeRes2.json();
  
  const signature2 = await wallet.signMessage(challengeData2.message);

  const gatingRes = await fetch(`${API_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: challengeData2.message,
      signature: signature2,
      address: address,
      gated: true // Habilita a validação de token-gating on-chain
    })
  });
  const gatingData: any = await gatingRes.json();
  console.log(` - Resultado do Token-Gating (Deve falhar por saldo = 0): success = ${gatingData.success}, erro = "${gatingData.error}"`);
  if (gatingData.success) {
    console.error('❌ FALHA DE SEGURANÇA: Servidor liberou acesso a carteira com saldo zero de tokens!');
  } else {
    console.log('✅ SUCESSO: O servidor conectou à blockchain via RPC e rejeitou o acesso por saldo insuficiente.');
  }

  console.log('\n==================================================');
  console.log('FIM DOS TESTES DE SEGURANÇA');
  console.log('==================================================');
}

runTests().catch(console.error);
