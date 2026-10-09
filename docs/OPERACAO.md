# Operação do Âncora

A configuração de VPS está em [DEPLOY.md](DEPLOY.md). O processo inicia somente o provedor OIDC e o portal. O Node escuta em loopback; Caddy termina o HTTPS público.

## Dados e configuração

`ANCORA_DATA_DIR` define o diretório persistente. O padrão local é `.local/`; em produção, use o caminho absoluto `/var/lib/ancora`.

- `provider.json`: issuer, redes autorizadas, chaves RSA privadas e chaves de cookies.
- `provider.sqlite`: sessões SSO, desafios, concessões, tokens, desenvolvedores e aplicações.
- `provider.sqlite.portal.sqlite`: sessões locais do portal.
- Arquivos `-wal` e `-shm`: arquivos auxiliares do SQLite; não os remova com o serviço ativo.

O setup novo inicia sem clientes de aplicações. O cliente interno do portal é criado pelo provedor. Configurações existentes são preservadas, inclusive clientes legados. A importação do JSON usa INSERT OR IGNORE: editar clientes já importados no JSON não altera o cadastro no banco.

Não copie dados do desenvolvimento para a VPS. As chaves devem ser geradas uma vez no ambiente de implantação e preservadas entre versões. Se ISSUER_URL divergir do issuer já salvo, o serviço não inicia; uma mudança de domínio exige migração coordenada de configurações, clientes e sessões.

## Variáveis

| Variável | Uso |
| --- | --- |
| ISSUER_URL | Origem pública do provedor; HTTPS obrigatório em produção |
| ANCORA_DATA_DIR | Caminho persistente; absoluto e obrigatório em produção |
| PORT | Porta interna HTTP, padrão 4200 |
| NODE_ENV | Use production na VPS |
| TRUST_LOOPBACK_PROXY | true para HTTPS terminado no Caddy local |

Segredos e bancos não são criptografados pela aplicação. O serviço usa usuário dedicado, umask 0077 e diretório privado. Backups também contêm segredos. A sessão do provedor e a sessão do portal são independentes, ambas persistidas.

## Proxy e cookies

O proxy substitui X-Forwarded-For, X-Forwarded-Proto e X-Forwarded-Host. A aplicação aceita encaminhamento apenas do loopback, e o listener não recebe conexões externas. Não exponha a porta interna nem habilite confiança em proxies arbitrários.

Cookies de produção usam Secure, HttpOnly e SameSite=Lax. Preserve a origem HTTPS em todos os retornos. O callback usa no-referrer; páginas com formulários mantêm same-origin para a validação de origem no logout.

## Backup e atualização

Pare o serviço para copiar o diretório completo de forma consistente. Armazene backups fora da VPS e verifique uma restauração em ambiente separado. O [guia de implantação](DEPLOY.md) contém os comandos de backup e atualização.

O SQLite é destinado a uma única instância neste projeto. Não há replicação, balanceamento entre múltiplos processos nem atualização sem interrupção. O rate limit também vive na memória do processo.

## Limitações para abertura pública

O cadastro pertence à carteira autenticada e permite até 25 aplicações por desenvolvedor. Não há verificação de propriedade do domínio, recuperação de carteira, equipes ou transferência de aplicações. A rotação de segredo invalida o anterior imediatamente; desativar um cliente não encerra sessões locais já existentes.

Antes de uso além dos testes, defina monitoramento, rotação de chaves, retenção e privacidade, backups e recuperação. Não há back-channel logout nem conformidade OIDC certificada desta implantação. O provedor valida contas EOA; não consulta saldos, envia transações ou solicita seed phrase.

## Diagnóstico

| Sintoma | Conferência |
| --- | --- |
| Serviço não inicia | Build, permissões, PORT, issuer persistido e variáveis obrigatórias |
| Login falha atrás do proxy | Origem HTTPS, cabeçalhos do Caddy e TRUST_LOOPBACK_PROXY |
| Erro de callback | URL exata cadastrada no portal |
| Portal não conclui descoberta | A VPS deve conseguir acessar o próprio domínio HTTPS |
| Cookie não volta | HTTPS e domínio coerentes; não misture localhost com IP |
| Sessões perdidas após atualizar | Diretório persistente e mesmas chaves; não regenere provider.json |
