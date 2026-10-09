# Publicar o Âncora em uma VPS

Esta configuração usa uma VPS Linux com systemd, Node.js e Caddy. O serviço inicia apenas o provedor e o portal. Não inclui aplicações de demonstração.

## 1. Preparar servidor e domínio

Use uma VPS com armazenamento persistente e uma distribuição Linux com systemd. Instale Node.js 22.13+ (recomendado: versão 22 atualizada), npm, Git e Caddy usando os canais oficiais. Confira `node --version` e `command -v node`; o serviço fornecido usa `/usr/bin/node`. Ajuste `ExecStart` caso seu caminho seja outro.

Aponte o registro DNS A de um domínio, por exemplo `auth.seudominio.com`, para o IP da VPS. Se publicar AAAA, ele também precisa alcançar a VPS. Libere portas 80 e 443; mantenha a 4200 privada. Caddy emite e renova o certificado HTTPS. O domínio deve ser acessível também pelo próprio servidor, pois o portal faz descoberta OIDC no provedor.

## 2. Instalar o código

Em uma VPS dedicada, clone o projeto em `/opt/ancora`:

```sh
sudo git clone https://github.com/thiagocalegaro/tcc-decentralized-auth.git /opt/ancora
cd /opt/ancora
sudo npm ci
sudo npm run build
sudo useradd --system --home-dir /var/lib/ancora --shell /usr/sbin/nologin ancora
sudo install -d -o ancora -g ancora -m 700 /var/lib/ancora
sudo install -d -m 700 /etc/ancora
sudo install -m 600 deploy/ancora.env.example /etc/ancora/ancora.env
sudoedit /etc/ancora/ancora.env
```

Crie o usuário apenas uma vez. Em `ancora.env`, substitua `https://auth.example.com` pela origem HTTPS real. Não acrescente caminhos a `ISSUER_URL`.

Não copie a pasta `.local` do desenvolvimento. O primeiro início cria novas chaves e um banco sem clientes de demonstração. Cada desenvolvedor registra a própria aplicação pelo portal.

## 3. Configurar o proxy e iniciar

Em uma instalação nova do Caddy, copie o modelo. Se o servidor já hospeda outros sites, acrescente o bloco ao Caddyfile existente em vez de substituí-lo.

```sh
sudo install -m 644 deploy/Caddyfile /etc/caddy/Caddyfile
sudoedit /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo install -m 644 deploy/ancora.service /etc/systemd/system/ancora.service
sudo systemctl daemon-reload
sudo systemctl enable --now ancora
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

Troque `auth.example.com` pelo mesmo hostname de `ISSUER_URL`. O modelo sobrescreve os cabeçalhos de encaminhamento; o Âncora confia somente em conexões do proxy local. Não publique a porta Node nem coloque outro proxy na cadeia sem rever essa configuração.

`StateDirectory` mantém dados em `/var/lib/ancora`. Reiniciar o serviço, atualizar o código ou recompilar não regenera as chaves. Alterar o issuer configurado quando já existem dados impede o início: isso exige uma migração planejada.

## 4. Verificar a publicação

```sh
sudo systemctl status ancora --no-pager
sudo journalctl -u ancora -n 50 --no-pager
curl --fail https://auth.seudominio.com/health
curl --fail https://auth.seudominio.com/.well-known/openid-configuration
```

Confirme que a descoberta anuncia a origem HTTPS correta, abra `/portal`, entre com uma carteira de teste, registre um cliente e conclua um login pela aplicação integrada. Confirme que os cookies de autenticação possuem `Secure` e `HttpOnly`. Reinicie o serviço e verifique que o cadastro e a sessão persistiram.

Em produção, o cadastro exige URLs HTTPS para as aplicações clientes. Para um desenvolvedor testar um backend local, use uma origem HTTPS acessível com o callback exato cadastrado. Não altere o issuer entre testes.

## 5. Atualizar

Faça backup antes de atualizar. Na VPS dedicada:

```sh
sudo systemctl stop ancora
cd /opt/ancora
sudo git pull --ff-only
sudo npm ci
sudo npm run build
sudo systemctl start ancora
```

Se a instalação ou o build falhar, resolva o erro antes de iniciar. O serviço sofre uma breve indisponibilidade durante atualizações; não há atualização sem interrupção nesta configuração. Não execute `setup` com parâmetros locais sobre dados de produção.

## 6. Backup e restauração

Para uma cópia consistente de todos os bancos SQLite e chaves, pare o serviço e copie o diretório inteiro, incluindo eventuais arquivos WAL. Execute como administrador e guarde a cópia fora da VPS:

```sh
sudo systemctl stop ancora
sudo tar -czf /root/ancora-backup-$(date +%Y%m%d-%H%M%S).tgz -C /var/lib ancora
sudo systemctl start ancora
```

Mesmo se a cópia falhar, volte a iniciar o serviço. Proteja o arquivo de backup: ele contém chaves privadas e segredos. Para restaurar, pare o serviço, preserve primeiro os dados atuais e restaure uma cópia completa em `/var/lib/ancora`, com proprietário `ancora:ancora` e permissões restritas. Use o mesmo issuer e verifique o login após reiniciar.

Mantenha também uma cópia privada de `/etc/ancora/ancora.env` e da configuração do Caddy. Não versione esses arquivos operacionais com dados reais.

## Escopo

O serviço e o SQLite funcionam em uma única VPS. Não inicie réplicas sobre o mesmo banco nem use disco efêmero. A contratação da VPS, configuração DNS e publicação real dependem de um servidor e domínio disponíveis; os arquivos do repositório preparam a implantação, mas não provisionam esses recursos.
