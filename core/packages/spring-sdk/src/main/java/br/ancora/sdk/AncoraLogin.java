package br.ancora.sdk;

import java.net.URI;
import java.util.Locale;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.oidc.userinfo.OidcUserService;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;

/** Configura o login OIDC em uma cadeia Spring Security dedicada ao Âncora. */
public final class AncoraLogin {
    private AncoraLogin() {}

    public static void configure(HttpSecurity http, ClientRegistrationRepository clients,
            URI redirectUri, String afterLogin) throws Exception {
        String path = redirectUri.getPath();
        if (path == null || !path.matches("/(?:[A-Za-z0-9_-]+/)*callback")
                || redirectUri.getQuery() != null || redirectUri.getFragment() != null
                || !afterLogin.matches("/[A-Za-z0-9/_-]*") || afterLogin.startsWith("//")) {
            throw new IllegalArgumentException("Configure caminhos locais válidos.");
        }
        var resolver = new DefaultOAuth2AuthorizationRequestResolver(clients, "/oauth2/authorization");
        resolver.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());
        var users = new OidcUserService();
        users.setRetrieveUserInfo(request -> true);
        http.oauth2Login(login -> login
            .authorizationEndpoint(endpoint -> endpoint.authorizationRequestResolver(resolver))
            .redirectionEndpoint(endpoint -> endpoint.baseUri(path))
            .userInfoEndpoint(endpoint -> endpoint.oidcUserService(request -> {
                var user = users.loadUser(request);
                identity(user);
                return user;
            }))
            .defaultSuccessUrl(afterLogin, true));
    }

    public static Identity identity(OidcUser user) {
        var profile = user.getUserInfo();
        String address = profile == null ? null : profile.getClaimAsString("wallet_address");
        Object chain = profile == null ? null : profile.getClaim("chain_id");
        if (address == null || !address.matches("0x[0-9a-fA-F]{40}")
                || !(chain instanceof Integer || chain instanceof Long)
                || ((Number) chain).longValue() < 1 || ((Number) chain).longValue() > 9007199254740991L
                || user.getIssuer() == null
                || !user.getSubject().equals(profile.getSubject())
                || !user.getSubject().equals("eip155:" + chain + ":" + address.toLowerCase(Locale.ROOT))) {
            throw new OAuth2AuthenticationException(new OAuth2Error("invalid_wallet_identity"));
        }
        return new Identity(user.getIssuer().toString(), user.getSubject(), address, ((Number) chain).longValue());
    }

    public record Identity(String issuer, String sub, String address, long chainId) {}
}
