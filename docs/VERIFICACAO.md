# Verificação — 19/10/2026

Ambiente local: Windows, Node.js 22.23.1 e Microsoft Edge.

## Resultado local

- Build TypeScript, SDK e bundle do login: concluído.
- Backend, protocolo, configuração e persistência: 17 testes passaram.
- Portal e identidade visual no navegador: 3 testes passaram.
- Demos, login e SSO no navegador: 8 testes passaram.
- `docker compose config --quiet`: configuração válida.

A inicialização do Docker Desktop local falhou no componente de inferência antes de disponibilizar o engine Linux. Portanto, a execução da imagem neste computador não foi confirmada. Esse erro do Docker Desktop não foi tratado por alterações no sistema operacional.

## Validação do contêiner no GitHub

O workflow [Verify Ancora and demos](https://github.com/thiagocalegaro/tcc-decentralized-auth/actions/workflows/verify.yml) usa Ubuntu 24.04, Node.js 22 e Chromium. Ele instala as dependências a partir do lockfile, compila, executa os testes de backend, constrói a imagem e inicia o Compose.

A suíte `npm run test:e2e:compose` acessa as portas 4200–4202 do contêiner real e verifica as demos, o portal e a logo. Depois, o workflow recria o contêiner e compara hashes das configurações persistidas, além de conferir os usuários nos bancos das duas demos. Consulte o resultado de cada execução no link acima.

## Cobertura

- Assinatura SIWE, PKCE, consumo único de códigos, expiração e rejeição de replay.
- Sessão SSO entre Biblioteca e Observatório; sessões locais e logout independentes.
- Bloqueio da página restrita e da API para usuários não autenticados.
- SDK: identidade validada, vínculo por `onLogin` e rejeição de vínculo inválido.
- Portal: criação, edição, rotação e desativação de clientes, isolamento entre proprietários e CSRF.
- Setup das demos: preservação de chaves e credenciais, recuperação de arquivo ausente e recusa de configuração inconsistente.
- SQLite: vínculo de usuários, expiração, consumo atômico, revogação e persistência após reinício.
- Layout desktop/mobile e arquivo da logo fornecida.
- Regras de produção continuam exigindo HTTPS; testes do proxy local verificam cookies Secure/HttpOnly e origem canônica.

## Limites

Os testes de navegador usam carteiras simuladas com assinaturas reais de chaves descartáveis. Não substituem homologação com todas as extensões de carteira.

As suítes locais comuns iniciam ambientes temporários nas portas 4400–4402. A suíte Compose usa os dados do volume e cria registros de teste; execute-a em um ambiente de desenvolvimento.

Não foram executados testes de carga, conformidade oficial OIDC ou implantação pública. O Compose entregue é um ambiente local de demonstração.
