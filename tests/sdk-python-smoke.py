"""Smoke test for the installed Flask SDK; run with Python after installing it."""
from unittest import TestCase, main
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from ancora_flask import AncoraClient
from flask import Flask


class FlaskSdkTest(TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.secret_key = "test-only-session-key"
        self.issuer = "https://provider.example"
        self.sdk = AncoraClient(self.app, issuer=self.issuer, client_id="client",
                                client_secret="test-secret", redirect_uri="https://site.example/auth/callback")

    def test_redirect_uses_state_nonce_and_pkce(self):
        with self.app.test_request_context("/auth/login"), patch.object(
            self.sdk.client, "load_server_metadata",
            return_value={"authorization_endpoint": self.issuer + "/authorize"}
        ):
            query = parse_qs(urlsplit(self.sdk.login().location).query)
        self.assertEqual(query["code_challenge_method"], ["S256"])
        self.assertEqual(query["scope"], ["openid wallet"])
        for name in ("state", "nonce", "code_challenge"):
            self.assertTrue(query[name][0])

    def test_callback_requires_parameters_and_matching_wallet_subject(self):
        address = "0x" + "a" * 40
        subject = f"eip155:1:{address}"
        token = {"userinfo": {"iss": self.issuer, "sub": subject}, "access_token": "test"}
        with self.app.test_request_context("/auth/callback"):
            with self.assertRaises(ValueError):
                self.sdk.callback()
        with self.app.test_request_context("/auth/callback?code=test&state=test"), patch.object(
            self.sdk.client, "authorize_access_token", return_value=token
        ), patch.object(self.sdk.client, "userinfo", return_value={
            "sub": subject, "wallet_address": address, "chain_id": 1,
        }) as profile:
            self.assertEqual(self.sdk.callback(), {"issuer": self.issuer, "sub": subject,
                                                   "address": address, "chainId": 1})
            profile.return_value["chain_id"] = 2
            with self.assertRaises(ValueError):
                self.sdk.callback()


if __name__ == "__main__":
    main()
