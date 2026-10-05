# Verificação do portal e da função pós-login · 28/09/2026

Testes executados em Node.js 22.23.1 e Microsoft Edge, em ambiente isolado. As carteiras são descartáveis; nenhuma carteira pessoal foi usada.

| Verificação | Resultado |
| --- | --- |
| TypeScript, build do SDK e bundle | Passou |
| Persistência, registro e protocolo | 10 testes passaram |
| Navegador, incluindo o portal | 10 testes passaram na execução final (51,6 s) |
| JavaScript do portal e exemplo Node | Checagem sintática passou |
| Desktop e celular | Páginas renderizam; sem transbordamento horizontal a 320 px |
| Segredo no painel | Exibido na criação/rotação; ausente das consultas e do armazenamento do navegador |

## Percurso comprovado

**História:** o desenvolvedor entra por carteira, cadastra um site, configura seu backend e recebe uma identidade verificada para criar uma conta local.

| Limite do fluxo | Evidência |
| --- | --- |
| Navegador → login | Assinatura SIWE real com chave efêmera, consentimento e callback |
| Portal → API | Cadastro e edição pelo formulário; nome reaparece após recarregar |
| API → banco | Proprietário vinculado à sessão; persistência confirmada após reabrir SQLite |
| Banco → OIDC | Cliente recém-criado funciona sem reiniciar; rotação invalida segredo anterior |
| OIDC → backend do site | ID Token/UserInfo validados; onLogin recebe identidade imutável |
| Backend → conta local | UUID estável em logins sucessivos; IDs independentes em cada site |
| Resposta → navegador | Redirecionamento configurado para /minha-conta; sessão com userId e carteira |

A criação de cliente pela interface e seu aceite imediato pelo endpoint de autorização foram testados no navegador. Um teste de integração separado executa o fluxo completo com um cliente criado durante a execução até a sessão no backend. O download do exemplo Node entrega código sem credenciais; o arquivo tem sintaxe validada, mas não recebeu uma execução ponta a ponta separada.

## Casos de segurança

- Carteira de outro desenvolvedor não consulta, edita, gira segredo ou desativa aplicações alheias; respostas 404, como para IDs inexistentes.
- Anônimos recebem 401; escritas sem CSRF ou com Origin incorreta recebem 403.
- Clientes de sistema ficam fora da gestão das carteiras.
- URLs HTTP públicas, credenciais em URLs, caminhos externos, codificados ou com navegação relativa são recusados.
- O segredo antigo deixa de completar login após a rotação. Aplicação desativada não autoriza novos fluxos.
- Falha em onLogin impede a emissão de uma nova sessão.
- Callback falsificado, falta de cookie de vínculo, PKCE incorreto, código reutilizado, mensagem alterada, assinante incorreto, desafio expirado e replay concorrente continuam recusados.
- Sessões locais independentes, SSO entre sites, logout local e logout do provedor continuam funcionando.

## Verificação visual

Capturas em `test-results/`: `ancora-home.png`, `portal-aplicacao.png`, `portal-integracao.png` e `portal-mobile.png`. O guia é expansível para manter a visão de gestão compacta. O percurso de sucesso não produziu erros JavaScript; respostas 401 esperadas da consulta anônima são tratadas pela interface.

A primeira tentativa no Edge parou na captura de uma página já carregada. O teste passou após configurar o navegador headless sem GPU; duas execuções completas subsequentes passaram. Os avisos de SQLite experimental no Node 22 continuam presentes.

## Limites

Não houve homologação com extensão pessoal, carteira móvel, múltiplos hosts nem suíte oficial de conformidade OIDC. O protótipo não verifica posse de domínio, não recupera carteira e não encerra sessões locais de terceiros ao desativar um cliente. Consulte [operação](OPERACAO.md).

## Repetir

```powershell
npm run build
npm test
npm run test:e2e
```

Os testes usam as portas 4400–4402 e bancos temporários. Não escrevem nos dados das aplicações em 4200–4202. Abra `playwright-report/index.html` para o relatório detalhado.
