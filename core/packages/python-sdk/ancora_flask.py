"""Integração de servidor com o Âncora. A aplicação é dona da sessão."""
import re
from urllib.parse import urlsplit

from authlib.integrations.flask_client import OAuth
from flask import request


def _url(value):
    url = urlsplit(value)
    if (not url.hostname or url.username is not None or url.password is not None
            or url.query or url.fragment or "\\" in value
            or (url.scheme != "https" and not (
                url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1", "::1"}
            ))):
        raise ValueError("Configure uma URL HTTPS ou HTTP em loopback.")
    return url


class AncoraClient:
    """Configure um cliente por aplicação Flask; use uma SECRET_KEY privada."""

    def __init__(self, app, *, issuer, client_id, client_secret, redirect_uri):
        if _url(issuer).path or not _url(redirect_uri).path:
            raise ValueError("Informe a origem do emissor e a URL exata de retorno.")
        if not app.secret_key or not client_id or not client_secret:
            raise ValueError("Configure a sessão Flask e as credenciais do cliente.")
        self.issuer = issuer
        self.redirect_uri = redirect_uri
        self.oauth = OAuth(app)
        self.client = self.oauth.register(
            name="ancora",
            client_id=client_id,
            client_secret=client_secret,
            server_metadata_url=issuer + "/.well-known/openid-configuration",
            client_kwargs={
                "scope": "openid wallet",
                "code_challenge_method": "S256",
                "token_endpoint_auth_method": "client_secret_post",
            },
        )

    def login(self):
        """Retorne o redirecionamento na rota GET de entrada."""
        return self.client.authorize_redirect(self.redirect_uri)

    def callback(self):
        """Retorne somente a identidade validada; nunca retorne tokens ao navegador."""
        if not request.args.get("code") or not request.args.get("state") or request.args.get("error"):
            raise ValueError("Retorno de autenticação inválido.")
        token = self.client.authorize_access_token()
        claims = token.get("userinfo")
        if not claims or claims.get("iss") != self.issuer:
            raise ValueError("Identidade inválida.")
        profile = self.client.userinfo(token=token)
        address, chain = profile.get("wallet_address"), profile.get("chain_id")
        if (not isinstance(address, str) or not re.fullmatch(r"0x[0-9a-fA-F]{40}", address)
                or type(chain) is not int or not 1 <= chain <= 9007199254740991
                or claims.get("sub") != f"eip155:{chain}:{address.lower()}"
                or profile.get("sub") != claims["sub"]):
            raise ValueError("Identidade de carteira inválida.")
        return {"issuer": self.issuer, "sub": claims["sub"], "address": address, "chainId": chain}
