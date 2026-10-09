# Verificação — 09/10/2026

Ambiente local: Windows, Node.js 22.23.1 e Microsoft Edge. Foi criada uma cópia apenas dos arquivos versionados, sem os diretórios, scripts e testes específicos das demonstrações. As dependências já instaladas foram reutilizadas nessa verificação.

## Cobertura

Resultado: build concluído, 13 testes de backend/protocolo e 3 testes de navegador passaram na cópia sem demos.

- Build TypeScript, compilação do SDK e bundle do login hospedado.
- Testes de configuração: primeira inicialização sem clientes de demonstração, preservação das chaves, recusa de mudança de issuer e de configuração corrompida.
- Configuração de produção: issuer HTTPS explícito.
- Proxy local: descoberta OIDC, cookies Secure/HttpOnly e redirecionamento para a origem HTTPS.
- Protocolo: assinatura SIWE, PKCE, consumo único do código e rejeição de desafios expirados.
- SDK: identidade validada, callback onLogin e falha fechada quando o vínculo de usuário é recusado.
- Registro: isolamento entre proprietários, rotação e desativação, validação de retornos.
- SQLite: expiração, consumo atômico, revogação e persistência após reabrir o banco.
- Portal no navegador: login, consentimento, cadastro, edição, rotação, desativação, CSRF e logout.
- Interfaces do Âncora em desktop e celular, incluindo a identidade visual.

## Limites da verificação

Os testes usam carteiras simuladas com assinaturas reais de chaves descartáveis. O teste de proxy injeta cabeçalhos de um proxy local; não substitui a verificação do Caddy, DNS e certificado em uma VPS.

A configuração systemd e o Caddyfile estão preparados para Linux, mas a implantação pública ainda depende de VPS e domínio. Não foram executados testes de carga, conformidade oficial OIDC ou homologação com todas as extensões de carteira.

Os testes de navegador iniciam apenas o provedor na porta 4400, com chaves e bancos temporários. Não dependem de aplicações de demonstração nem alteram a configuração local em .local.
