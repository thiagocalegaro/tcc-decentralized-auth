# Âncora para Spring Boot

Use Java 17+, Maven e Spring Boot 3.5.x com Spring Security 6.5. Extraia este pacote em uma pasta própria e execute mvn install. No POM do site, adicione br.ancora:ancora-spring:0.1.0 e os starters spring-boot-starter-web e spring-boot-starter-oauth2-client.

Cadastre a origem e o retorno no portal. Use o registro ancora abaixo:

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          ancora:
            client-id: ${ANCORA_CLIENT_ID}
            client-secret: ${ANCORA_CLIENT_SECRET}
            client-authentication-method: client_secret_post
            authorization-grant-type: authorization_code
            redirect-uri: ${ANCORA_REDIRECT_URI}
            scope: openid,wallet
        provider:
          ancora:
            issuer-uri: ${ANCORA_ISSUER}
```

Ajuste a porta e o cookie de sessão da aplicação conforme seu ambiente. Use HTTPS fora do desenvolvimento local. Na SecurityFilterChain dedicada ao login do Âncora:

```java
@Bean
SecurityFilterChain security(HttpSecurity http, ClientRegistrationRepository clients,
        @Value("${ANCORA_REDIRECT_URI}") String callback) throws Exception {
    var uri = URI.create(callback);
    http.authorizeHttpRequests(routes -> routes
        .requestMatchers("/", "/login", "/error", "/oauth2/**", uri.getPath()).permitAll()
        .anyRequest().authenticated());
    AncoraLogin.configure(http, clients, uri, "/minha-conta");
    return http.build();
}
```

Importe br.ancora.sdk.AncoraLogin, java.net.URI, org.springframework.beans.factory.annotation.Value, org.springframework.context.annotation.Bean, org.springframework.security.config.annotation.web.builders.HttpSecurity, org.springframework.security.oauth2.client.registration.ClientRegistrationRepository e org.springframework.security.web.SecurityFilterChain. Mantenha a classe de configuração no pacote da aplicação ou em um subpacote.

O link de login é /oauth2/authorization/ancora. Receba OidcUser via @AuthenticationPrincipal na página privada e use AncoraLogin.identity(user) para obter apenas a identidade da carteira. O Spring Security cria a sessão; não devolva os tokens ao navegador. A associação a um usuário do seu banco deve usar (issuer, sub).
