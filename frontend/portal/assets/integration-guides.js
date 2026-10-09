// These are integration fragments, not standalone application downloads.
export function renderIntegrationGuides(application, issuer) {
  let container = document.getElementById('other-language-guides');
  if (!container) {
    container = document.createElement('section');
    container.id = 'other-language-guides';
    container.setAttribute('aria-label', 'Integração em outras linguagens');
    document.querySelector('#app-detail .management').before(container);
  }
  container.replaceChildren();
  const configuration = `ANCORA_ISSUER=${issuer}
ANCORA_CLIENT_ID=${application.id}
ANCORA_CLIENT_SECRET=COLOQUE_O_SEGREDO_AQUI
ANCORA_REDIRECT_URI=${application.redirectUri}
APP_URL=${application.appUrl}`;

  function element(tag, text, parent) {
    const node = document.createElement(tag);
    node.textContent = text;
    parent.append(node);
    return node;
  }
  function code(parent, text) {
    const pre = element('pre', text, parent);
    pre.tabIndex = 0;
    const button = element('button', 'Copiar código', parent);
    button.type = 'button'; button.className = 'secondary';
    const feedback = element('p', '', parent);
    feedback.setAttribute('role', 'status');
    button.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); feedback.textContent = 'Copiado.'; }
      catch { feedback.textContent = 'Selecione o código e copie manualmente.'; }
    });
  }
  function guide(name, install, source) {
    const details = element('details', '', container);
    details.className = 'guide language-guide';
    element('summary', `Integrar ao backend · ${name}`, details);
    element('p', 'O site encaminha o usuário ao Âncora. Depois da autorização, uma biblioteca no seu servidor confirma a identidade e você cria a sessão do seu site. A carteira é usada somente na página do Âncora.', details);
    element('p', '1. Instale as dependências no projeto do seu backend.', details);
    code(details, install);
    element('p', '2. Defina estas variáveis no ambiente privado do servidor. Troque o marcador pelo segredo recebido no cadastro. O endereço de retorno precisa ser exatamente o cadastrado abaixo. Um arquivo .env só funciona se seu ambiente o carregar.', details);
    code(details, configuration);
    const link = element('a', `Documentação da biblioteca para ${name}`, details);
    link.href = source; link.target = '_blank'; link.rel = 'noopener noreferrer';
    return details;
  }

  const python = guide('Python / Flask', 'python -m pip install Flask Authlib requests', 'https://docs.authlib.org/en/stable/oauth2/client/web/flask.html');
  element('p', '3. No módulo da sua aplicação Flask, configure o cliente. Defina também SESSION_SECRET com um valor aleatório e privado. O exemplo mantém a identidade em um cookie assinado; não armazene tokens nem segredos nele. Para sessões revogáveis, use armazenamento no servidor.', python);
  code(python, `import os
from datetime import timedelta
from urllib.parse import urlsplit
from flask import Flask, session, redirect, abort
from authlib.integrations.flask_client import OAuth
from authlib.integrations.base_client.errors import OAuthError
from requests.exceptions import RequestException

app = Flask(__name__)
app.secret_key = os.environ['SESSION_SECRET']
app.config.update(
    SESSION_COOKIE_NAME='ancora_site_session',
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=os.environ['APP_URL'].startswith('https://'),
    PERMANENT_SESSION_LIFETIME=timedelta(minutes=30),
    SESSION_REFRESH_EACH_REQUEST=False,
)
issuer = os.environ['ANCORA_ISSUER']
callback_url = os.environ['ANCORA_REDIRECT_URI']
oauth = OAuth(app)
ancora = oauth.register(
    name='ancora',
    client_id=os.environ['ANCORA_CLIENT_ID'],
    client_secret=os.environ['ANCORA_CLIENT_SECRET'],
    server_metadata_url=issuer + '/.well-known/openid-configuration',
    client_kwargs={
        'scope': 'openid wallet',
        'code_challenge_method': 'S256',
        'token_endpoint_auth_method': 'client_secret_post',
    },
)

@app.get('/auth/login')
def login():
    return ancora.authorize_redirect(callback_url)

@app.get(urlsplit(callback_url).path)
def callback():
    try:
        token = ancora.authorize_access_token()
        claims = token['userinfo']  # identidade já validada
        profile = ancora.userinfo(token=token)
        if claims['iss'] != issuer or profile['sub'] != claims['sub']:
            abort(400)
        session.clear()
        session.permanent = True
        session['identity'] = {
            'issuer': claims['iss'], 'sub': claims['sub'],
            'address': profile['wallet_address'],
            'chainId': profile['chain_id'],
        }
        return redirect('/minha-conta')
    except (OAuthError, RequestException, KeyError):
        abort(400, 'Não foi possível entrar. Inicie o login novamente.')

@app.get('/minha-conta')
def account():
    if 'identity' not in session:
        return redirect('/auth/login')
    return session['identity']`);
  element('p', '4. Antes de salvar a sessão no callback, procure ou crie o usuário do seu banco por (issuer, sub) e guarde o ID local junto da identidade. Use uma restrição única para evitar contas duplicadas. O trecho acima mostra a autenticação; o vínculo com seu banco é responsabilidade da aplicação.', python);
  element('p', '5. Salve como app.py. Para teste local, execute python -m flask --app app run --host localhost --port PORTA, usando a porta do Endereço do site cadastrado. Crie uma página pública com o link abaixo. Em produção, use HTTPS e um servidor apropriado para Flask.', python);
  code(python, '<a href="/auth/login">Entrar com Âncora</a>');

  const php = guide('PHP', 'composer require jumbojett/openid-connect-php', 'https://github.com/jumbojett/OpenID-Connect-PHP');
  element('p', '3. Use o trecho abaixo no controlador que atende tanto /auth/login quanto o caminho de retorno cadastrado. Configure essas duas rotas no seu framework ou servidor web; criar apenas um arquivo PHP não cria essas rotas. O Composer precisa ter gerado vendor/autoload.php.', php);
  code(php, `<?php
require __DIR__ . '/vendor/autoload.php';

use Jumbojett\\OpenIDConnectClient;

session_name('ancora_site_session');
ini_set('session.use_strict_mode', '1');
session_set_cookie_params([
    'httponly' => true,
    'secure' => str_starts_with(getenv('APP_URL'), 'https://'),
    'samesite' => 'Lax',
]);
session_start();
$issuer = getenv('ANCORA_ISSUER');
$client = new OpenIDConnectClient(
    $issuer, getenv('ANCORA_CLIENT_ID'), getenv('ANCORA_CLIENT_SECRET')
);
$client->setRedirectURL(getenv('ANCORA_REDIRECT_URI'));
$client->addScope('wallet'); // openid é incluído pela biblioteca
$client->setCodeChallengeMethod('S256');

try {
    if (!$client->authenticate()) {
        throw new RuntimeException('Login incompleto');
    }
    $claims = $client->getVerifiedClaims();
    $profile = $client->requestUserInfo();
    if ($claims->iss !== $issuer || $profile->sub !== $claims->sub) {
        throw new RuntimeException('Identidade inválida');
    }
    // Aqui, encontre/crie a conta por (issuer, sub) no seu banco.
    session_regenerate_id(true);
    $_SESSION['identity'] = [
        'issuer' => $claims->iss, 'sub' => $claims->sub,
        'address' => $profile->wallet_address,
        'chainId' => $profile->chain_id,
    ];
    $_SESSION['expires_at'] = time() + 1800;
    header('Location: /minha-conta', true, 303);
    exit;
} catch (Throwable $error) {
    http_response_code(400);
    echo 'Não foi possível entrar. Inicie o login novamente.';
}`);
  element('p', 'O Âncora anuncia o envio do segredo no corpo da requisição (client_secret_post). A biblioteca PHP usa esse envio quando o provedor não anuncia autenticação Basic. Mantenha a descoberta automática e a verificação de certificados habilitadas.', php);
  element('p', '4. No controlador de /minha-conta e em cada recurso privado, carregue a mesma configuração de sessão e verifique o acesso antes de enviar conteúdo. Após implementar o vínculo com o banco, salve e use também o ID do usuário local.', php);
  code(php, `<?php
// Execute antes o mesmo bloco de configuração e session_start().
if (empty($_SESSION['identity']) || ($_SESSION['expires_at'] ?? 0) <= time()) {
    unset($_SESSION['identity'], $_SESSION['expires_at']);
    header('Location: /auth/login', true, 303);
    exit;
}
header('Content-Type: application/json; charset=utf-8');
echo json_encode($_SESSION['identity']);`);
  element('p', '5. Adicione o botão de entrada na página pública. Configure o servidor PHP no endereço cadastrado e confira se o caminho de retorno chega ao controlador de autenticação.', php);
  code(php, '<a href="/auth/login">Entrar com Âncora</a>');

  const java = guide('Java / Spring Boot', `<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-web</artifactId>
</dependency>
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-oauth2-client</artifactId>
</dependency>`, 'https://docs.spring.io/spring-security/reference/servlet/oauth2/login/core.html');
  element('p', 'Use um projeto Maven com Java 17 ou superior e Spring Boot 3.5.x (Spring Security 6.5). Adicione as dependências acima dentro de dependencies no pom.xml; o Spring Boot gerencia suas versões. Mantenha a classe principal com @SpringBootApplication gerada pelo seu projeto.', java);
  element('p', '3. Em src/main/resources/application.yml, configure o cliente e a sessão. O Spring lê as variáveis do ambiente do processo; não carrega um arquivo .env automaticamente. Inicie o Âncora antes da aplicação Java, pois o Spring consulta suas configurações durante a inicialização.', java);
  code(java, `spring:
  security:
    oauth2:
      client:
        registration:
          ancora:
            provider: ancora
            client-id: \${ANCORA_CLIENT_ID}
            client-secret: \${ANCORA_CLIENT_SECRET}
            client-authentication-method: client_secret_post
            authorization-grant-type: authorization_code
            redirect-uri: \${ANCORA_REDIRECT_URI}
            scope: openid,wallet
        provider:
          ancora:
            issuer-uri: \${ANCORA_ISSUER}
server:
  port: ${new URL(application.appUrl).port || (application.appUrl.startsWith('https:') ? '443' : '80')}
  servlet:
    session:
      timeout: 30m
      cookie:
        name: ANCORA_JAVA_SESSION
        http-only: true
        same-site: lax
        secure: ${application.appUrl.startsWith('https:')}`);
  element('p', 'A porta acima segue o endereço cadastrado para acesso direto. Se houver proxy ou hospedagem com HTTPS, ajuste a porta interna e a terminação HTTPS da sua implantação. Em produção, o cookie deve usar secure: true.', java);
  element('p', '4. Crie SecurityConfig.java no pacote da aplicação. O código reconhece o caminho de retorno cadastrado, exige login nas páginas privadas e usa a proteção adicional exigida pelo Âncora em cada tentativa de entrada. Mantenha os dois arquivos Java abaixo no mesmo pacote da classe principal ou em um subpacote.', java);
  code(java, `package com.exemplo.ancora; // adapte ao pacote do seu projeto

import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserService;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {
    @Bean
    SecurityFilterChain security(HttpSecurity http,
            ClientRegistrationRepository clients,
            @Value("\${ANCORA_REDIRECT_URI}") String redirectUri) throws Exception {
        String callbackPath = URI.create(redirectUri).getPath();
        var requests = new DefaultOAuth2AuthorizationRequestResolver(
            clients, "/oauth2/authorization");
        requests.setAuthorizationRequestCustomizer(
            OAuth2AuthorizationRequestCustomizers.withPkce());

        var users = new OidcUserService();
        // Os dados da carteira vêm da consulta ao Âncora após validar o login.
        users.setRetrieveUserInfo(request -> true);

        http.authorizeHttpRequests(routes -> routes
            .requestMatchers("/", "/error", "/login", "/oauth2/**", callbackPath).permitAll()
            .anyRequest().authenticated());
        http.oauth2Login(login -> login
            .authorizationEndpoint(endpoint -> endpoint.authorizationRequestResolver(requests))
            .redirectionEndpoint(endpoint -> endpoint.baseUri(callbackPath))
            .userInfoEndpoint(endpoint -> endpoint.oidcUserService(users))
            .defaultSuccessUrl("/minha-conta", true)
            .failureUrl("/login?error"));
        http.logout(logout -> logout.logoutSuccessUrl("/"));
        return http.build();
    }
}`);
  element('p', 'O Spring valida a resposta de login, consulta os dados da carteira e mantém a sessão no servidor. O navegador recebe apenas o identificador da sessão. A consulta explícita aos dados do usuário é necessária porque o Âncora usa o escopo wallet.', java);
  element('p', '5. Crie ContaController.java. A página inicial oferece o link de entrada; /minha-conta mostra somente a identidade necessária, sem devolver tokens ao navegador.', java);
  code(java, `package com.exemplo.ancora; // mesmo pacote da configuração

import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ContaController {
    @GetMapping(value = "/", produces = "text/html; charset=UTF-8")
    public String home() {
        return "<a href='/oauth2/authorization/ancora'>Entrar com Âncora</a>";
    }

    @GetMapping("/minha-conta")
    public Map<String, Object> account(@AuthenticationPrincipal OidcUser user) {
        return Map.of(
            "issuer", user.getIssuer().toString(),
            "sub", user.getSubject(),
            "address", user.getClaimAsString("wallet_address"),
            "chainId", user.getClaim("chain_id")
        );
    }
}`);
  element('p', '6. Para vincular ao banco do site, adicione um serviço que encontre ou crie o usuário por (issuer, sub), com uma restrição única. Chame esse serviço após users.loadUser(request) em um OidcUserService personalizado, antes de retornar o usuário validado. Se o vínculo falhar, interrompa o login com OAuth2AuthenticationException. Nome e e-mail não são fornecidos pela carteira.', java);
  element('p', '7. Com as variáveis definidas, execute o projeto pelo Maven Wrapper. No Windows use mvnw.cmd spring-boot:run; no Linux ou macOS, ./mvnw spring-boot:run. Abra o Endereço do site cadastrado. O callback é atendido pelo Spring Security; não crie um controlador para ele.', java);
  code(java, '<a href="/oauth2/authorization/ancora">Entrar com Âncora</a>\n<a href="/logout">Sair deste site</a>');
  element('p', 'O link Sair abre a confirmação padrão do Spring; a saída é concluída por um formulário protegido. A sessão Java expira após 30 minutos de inatividade. Sair do site não encerra a sessão no Âncora nem nos outros sites. Nenhum acesso é renovado por refresh token neste exemplo.', java);

  for (const details of [python, php, java]) {
    element('p', 'Como conferir: entre com uma carteira, autorize o site e abra /minha-conta. Repita com a mesma carteira para confirmar que a conta local é reutilizada. Em janela anônima, a página privada deve pedir login. Se cancelar ou expirar a entrada, nenhum novo acesso deve ser criado.', details);
    if (details !== java) element('p', 'Para adicionar Sair, crie uma rota POST com proteção contra pedidos de outros sites e apague a sessão local. Isso não encerra o acesso ao Âncora nem aos outros sites. Os exemplos usam 30 minutos de validade local e não renovam o acesso automaticamente.', details);
    element('p', 'Estes são trechos para adaptar ao seu projeto, não aplicações completas para download. O endereço da carteira não fornece nome nem e-mail. O segredo fica no servidor e a chave privada permanece na carteira.', details);
  }
}
