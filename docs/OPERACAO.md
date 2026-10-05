# Operação e limites

## Arquivos privados

`npm run setup` cria chaves RSA, chave de assinatura de cookies e segredos de cliente aleatórios. Reexecutar o comando preserva a configuração. O diretório `.local` guarda:

- `provider.json`: emissor, redes permitidas, clientes iniciais e chaves privadas;
- `demo-a.json` e `demo-b.json`: credenciais de cada site;
- `provider.sqlite`: sessão SSO, interações, concessões, tokens, desenvolvedores e aplicações;
- `provider.sqlite.portal.sqlite`: sessões locais do portal;
- bancos dos sites: sessões e tabela `app_users` com vínculo de identidade;
- `clients/`, se existir de uma edição antiga: credenciais legadas, não usadas para cadastrar pelo portal.

Não publique esse diretório. Restrinja o acesso no sistema operacional. O modo de arquivo POSIX não configura ACLs do Windows. Dados e segredos ficam sem criptografia de aplicação no disco; use armazenamento protegido e um gerenciador de segredos antes de hospedar para usuários reais. Faça backups consistentes com o modo WAL do SQLite, usando sua API de backup ou com os processos encerrados.

## Migração para o portal

Ao iniciar esta edição, o provedor cria as tabelas do portal e importa clientes de `provider.json` com `INSERT OR IGNORE`. Preserva IDs, segredos e clientes já existentes. Esses clientes iniciais ficam sem proprietário e não aparecem no painel de uma carteira. O cliente interno `ancora-portal` é criado uma vez e mantém seu segredo no banco privado.

Depois da importação, o registro SQLite é a fonte dos metadados dos clientes. Editar uma entrada já importada em `provider.json` não altera seu cadastro. Para novos sites, use `/portal`. O comando legado `register:client` apenas informa o endereço do portal e não escreve configurações. Mudança de issuer/origens de clientes de sistema exige migração coordenada do banco e configurações, com os serviços parados; não apague bancos reais como atalho.

Antes de atualizar ou migrar, faça backup consistente de `.local`. Sessões locais anteriores sem `userId` continuam válidas até expirarem; um novo login cria o vínculo de usuário. Na aplicação integrada, configure explicitamente `afterLogin: '/arearestrita'` se dependia do retorno antigo. O novo padrão do SDK é `/`.

## Portas e execução

O launcher executa os três aplicativos no mesmo processo Node, cada um em uma porta e com banco separado. Isso facilita a comparação local, mas não simula isolamento de processos ou hosts. Ele escuta apenas `127.0.0.1`. Ctrl+C fecha os servidores e bancos. As sessões persistidas sobrevivem ao reinício enquanto permanecem válidas.

Para definir portas antes da primeira configuração:

```powershell
$env:ISSUER_URL = 'http://localhost:4500'
$env:DEMO_A_URL = 'http://localhost:4501'
$env:DEMO_B_URL = 'http://localhost:4502'
npm run setup
```

Se a configuração já existe, essas variáveis não sobrescrevem as URLs. Edite os arquivos privados com os serviços parados e mantenha emissores e callbacks consistentes. Reinicie as sessões de teste após mudar as URLs. O launcher falha se a porta estiver ocupada; ele não encerra processos de outros projetos.

## HTTP local e HTTPS

HTTP é permitido somente em loopback com opção explícita. `NODE_ENV=production` exige HTTPS. Os cookies usam HttpOnly, SameSite=Lax e Secure quando a origem é HTTPS. SameSite=Lax permite o retorno de navegação de outro domínio; a proteção adicional vem de `state`, PKCE, nonce e vínculo do cookie de fluxo.

Cookies não são isolados por porta. Na demonstração, nomes distintos e bancos separados evitam colisões, mas serviços em `localhost` compartilham o host de cookies. Use domínios próprios em uma implantação real.

As páginas usam `Referrer-Policy: same-origin` para permitir a verificação de origem dos formulários de logout. O callback usa `no-referrer` e não carrega recursos antes de remover o código da URL. Aplicar `no-referrer` a páginas com formulários pode resultar em `Origin: null`, que a biblioteca rejeita. Consulte a [referência de Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy).

O launcher é local e não oferece TLS ou implantação em nuvem. Para hospedar, crie entradas de servidor para cada aplicação, termine TLS nos próprios servidores ou configure um proxy conhecido e restrito, e cadastre as URLs HTTPS. Não habilite confiança irrestrita em `X-Forwarded-*`. `createProviderApp` e `createDemoApp` exportam aplicações Express para esse fim.

## Antes de produção

- Revisar ameaças, isolamento entre aplicações, limites por IP/conta e armazenamento compartilhado. O rate limit desta versão fica na memória do processo.
- Definir rotação de chaves com período de sobreposição, ciclo de vida dos segredos, revogação, monitoramento e backups. Nenhuma rotação automática foi implementada.
- Avaliar um adaptador de banco para múltiplas instâncias. SQLite e o adaptador desta entrega atendem um host de protótipo, não um cluster.
- Acrescentar teste com extensões reais, carteiras móveis se necessárias, matriz de navegadores e suíte de conformidade OIDC. A simulação de EIP-1193 dos testes não substitui homologação com carteiras reais.
- Definir recuperação de acesso após perda da chave. O Âncora não consegue recuperar ou redefinir a chave privada do usuário.
- Implementar verificação de propriedade de domínio, política contra aplicações abusivas, trilha de auditoria, equipes e recuperação/transferência de aplicações antes de abrir o portal ao público. Nesta versão, qualquer carteira autenticada pode cadastrar até 25 aplicações e não há exclusão pelo portal.
- Planejar a rotação de segredo do cliente: a ação no portal invalida o anterior imediatamente e não oferece sobreposição. Atualize as credenciais no backend integrado. Desativação não encerra sessões locais já abertas nem garante revogar todos os tokens emitidos.
- Definir política de privacidade, retenção e consentimento. Endereços de carteira e identificadores de sessão são dados potencialmente vinculáveis a pessoas.
- Se necessário, implementar back-channel logout e política de revogação das sessões das aplicações. O logout SSO atual não força a saída de outros sites.

O protótipo não consulta saldos, não publica transações, não solicita seed phrase e não usa um serviço RPC para validar carteiras EOA. A rede integra a identidade, mas a prova de controle acontece fora da blockchain.

## Diagnóstico

| Sintoma | Conferência |
| --- | --- |
| Carteira não aparece | Extensão habilitada no navegador; EIP-6963 ou `window.ethereum` |
| Rede não permitida | Selecione Ethereum ou Sepolia |
| `invalid_redirect_uri` | URL exata no portal; para clientes de sistema, registro importado no banco |
| Falha no retorno | Não misture `localhost` e `127.0.0.1`; reinicie pelo botão do site |
| Porta em uso | Feche apenas a execução anterior desta alternativa ou configure outras portas |
| Login reaparece após sair | Saída local preserva SSO; use a opção de sair do Âncora |
| Biblioteca não encontrada | Execute `npm run build` ou instale o `.tgz` gerado por `pack:sdk` |
| Aviso SQLite no Node 22 | Aviso experimental do runtime; acompanhe a estabilidade antes de produção |
