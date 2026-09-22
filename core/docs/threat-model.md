# Modelo de ameaças · Âncora 0.1.0

Escopo: login EOA com SIWE, API de autenticação, SDK, BFF e área privada da demonstração. As defesas descritas correspondem ao código desta entrega. O documento orienta os testes e as próximas decisões; ele não certifica o sistema para produção.

## Ativos e fronteiras

O usuário controla a chave da carteira. A extensão expõe ao navegador o endereço, a rede e a assinatura aprovada pelo usuário. O projeto não solicita exportação da chave nem frase de recuperação.

O navegador mantém o código por tempo curto para concluir o fluxo. O BFF mantém o segredo de cliente, o verificador PKCE e os registros de sessão. A API mantém a chave privada ES256 e o estado dos desafios e códigos. A chave ES256 permite emitir asserções aceitas pelo BFF, portanto seu comprometimento permite forjar autenticações.

| Fronteira | Dados e controle exigido |
| --- | --- |
| Página → carteira | Solicitação após ação do usuário; conferir mensagem, domínio, conta e rede |
| Navegador → API | Origem cadastrada, conteúdo SIWE vinculado ao desafio e assinatura válida |
| Navegador → BFF | Origem exata, JSON em mutações, cookie de fluxo correspondente ao `flowId` |
| BFF → API | Segredo do cliente, código, URI e verificador PKCE; rejeição de redirecionamentos pelo BFF |
| API → BFF | Asserção ES256 com emissor, audiência, tempos, `jti` e identidade validados |
| Backends → armazenamento | Consumo atômico, expiração, hashes de credenciais opacas e limites de capacidade |

O modelo presume que o atacante possa controlar uma página em outra origem, enviar requisições fora do navegador, repetir mensagens observadas e disputar requisições concorrentes. O modelo também considera perda da carteira, exposição do servidor e dependências comprometidas como riscos residuais.

## Ameaças e tratamento atual

| Ameaça | Controle implementado | Limite ou verificação necessária |
| --- | --- | --- |
| Repetir uma assinatura | Nonce aleatório, expiração, hash da mensagem original e consumo atômico do desafio | Exercitar repetição e duas verificações concorrentes; assinatura válida não dispensa o estado do desafio |
| Alterar domínio, conta, rede ou validade | SDK confere campos antes de assinar; API compara mensagem e contexto armazenados e verifica SIWE | Um frontend comprometido pode apresentar uma interface enganosa; o usuário deve conferir a carteira |
| Capturar um código de login | Código curto, hash no armazenamento, vínculo a cliente, URI e PKCE S256 | O código não deve aparecer em logs, URLs ou ferramentas de análise |
| Usar um código duas vezes | Consumo único após conferir cliente, URI e PKCE | A suíte precisa cobrir concorrência e garantir que PKCE errado não consuma o código legítimo |
| Login CSRF e troca de sessão | Cookie HttpOnly de fluxo, `flowId`, PKCE guardado no servidor, origem exata e `SameSite=Strict` | Cookies e PKCE precisam pertencer ao mesmo fluxo; CORS sozinho não oferece essa garantia |
| Forjar asserção ou usar a de outro cliente | Verificação ES256 via JWKS, `iss`, `aud`, `typ`, tempos e campos da carteira | A chave privada e a configuração do emissor fazem parte da base de confiança |
| Repetir uma asserção | BFF guarda `jti` consumido até sua expiração | O registro está em memória; várias instâncias precisam compartilhar esse estado |
| Fixar ou roubar a sessão | Novo token aleatório no login, hash no servidor, cookie HttpOnly, invalidação da sessão anterior e logout | XSS pode executar ações na sessão mesmo sem ler o cookie; proteção HttpOnly não elimina XSS |
| Manter sessão esquecida | Expiração por inatividade de 30 minutos e absoluta de oito horas | Desconectar a carteira após o login não revoga a sessão da aplicação |
| Trocar conta ou rede durante assinatura | SDK cancela ao receber eventos e confere conta/rede entre etapas | Provedores sem eventos dependem das conferências; prompts pertencem à carteira e podem continuar visíveis |
| Criar sessão após cancelamento/logout concorrente | BFF preserva o vínculo do fluxo até criar a sessão e verifica seu cancelamento | Adaptadores futuros precisam manter essa semântica atômica |
| Nome ou ícone malicioso de carteira | Interface renderiza o nome como texto e ignora SVG/ícones fornecidos pela extensão | A descoberta de uma extensão não comprova reputação nem integridade do fornecedor |
| Abuso por muitas requisições | Limites por processo, corpos pequenos, validação de esquema, capacidade limitada dos stores em memória | Uma implantação distribuída precisa de limites compartilhados, política de proxy e monitoramento |
| Vazamento em logs | Backends evitam corpos e credenciais; auditoria da API usa hash do identificador | Hash de endereço público é correlacionável; falta política operacional de retenção e acesso |
| Falha ou reinício do serviço | Health checks e expiração de estado; PostgreSQL disponível para desafios/códigos | Sessões e fluxos do BFF permanecem em memória; reiniciar o BFF encerra sessões |

## Parâmetros que fazem parte da defesa

O ambiente local usa a origem `http://localhost:5173`, com API na porta `3001` e BFF na `3002`. As comparações de origem incluem esquema, hostname e porta. Alterar a URL aberta no navegador exige revisar `WEB_ORIGIN`, a URI cadastrada e os endereços dos serviços de forma coerente.

A API e o BFF aceitam HTTP no desenvolvimento local. Uma implantação remota precisa de HTTPS e cookies `Secure`. Em HTTPS, o BFF usa nomes de cookie com prefixo `__Host-`, caminho `/` e ausência de atributo `Domain`. A origem local em HTTP usa os nomes sem prefixo.

O BFF aplica cabeçalhos de segurança, incluindo CSP, nas respostas que serve. Durante desenvolvimento, o HTML vem do Vite na porta `5173`; não se deve atribuir ao HTML do Vite a mesma CSP do BFF. Uma implantação precisa validar os cabeçalhos no ponto que serve a interface.

O script de preparação gera o segredo do cliente e a chave ES256 em arquivos ignorados pelo Git. O repositório usa credenciais públicas apenas para o PostgreSQL de desenvolvimento/CI. O operador precisa gerenciar segredos, permissões de arquivo, cópias de segurança e rotação conforme o ambiente de implantação.

## Riscos fora da proteção desta versão

- Uma pessoa com a chave privada pode autenticar como aquela conta. O projeto não distingue o dono original de quem roubou a chave.
- Uma extensão, dispositivo ou página comprometida pode induzir assinaturas ou agir com a sessão atual. O protótipo não atesta a integridade desses componentes.
- O comprometimento do BFF, da API ou da chave ES256 permite interferir na autenticação. O controle da carteira pelo usuário não remove a confiança nesses servidores.
- O endereço permite correlação entre serviços e dados públicos on-chain. O protótipo não fornece anonimato nem credenciais seletivas.
- A carteira não comprova nome civil ou unicidade de pessoa. Vinculação a cadastros, autorização por perfil e recuperação de conta exigem regras adicionais.
- ERC-1271, carteiras contrafactuais e políticas de revalidação on-chain ficam fora do escopo EOA atual.

## Evidências e próximos testes

Consulte [VALIDACAO.md](VALIDACAO.md) para os comandos executados, resultados e limitações da entrega. Os testes locais da memória não comprovam o SQL contra PostgreSQL. A suíte PostgreSQL usa `TEST_DATABASE_URL`, cria um schema isolado e exige uma base de testes com as permissões correspondentes. O CI contém um serviço PostgreSQL; a presença do workflow não representa uma execução aprovada.

Para ampliar o sistema, priorize o store persistente do BFF e os testes de concorrência entre instâncias. Depois adicione testes com extensões reais, política de rotação de chaves, análise de dependências, cabeçalhos no servidor Web definitivo e retenção de logs. O estudo acadêmico deve registrar a versão da carteira, o cenário testado e a causa das falhas para separar problemas de protocolo, integração e usabilidade.
