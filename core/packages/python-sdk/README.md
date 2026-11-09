# Âncora para Flask

Python 3.10+. Extraia o pacote em uma pasta própria e execute python -m pip install . nela, usando o ambiente virtual do seu site. Cadastre a origem e o callback no portal. Configure ANCORA_ISSUER, ANCORA_CLIENT_ID, ANCORA_CLIENT_SECRET, ANCORA_REDIRECT_URI e SESSION_SECRET no ambiente do backend. Use um SESSION_SECRET aleatório e exclusivo desta aplicação.

```python
import os
from datetime import timedelta
from urllib.parse import urlsplit
from flask import Flask, abort, redirect, session
from authlib.integrations.base_client.errors import OAuthError
from requests.exceptions import RequestException
from ancora_flask import AncoraClient

app = Flask(__name__)
app.secret_key = os.environ["SESSION_SECRET"]
callback = os.environ["ANCORA_REDIRECT_URI"]
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                  SESSION_COOKIE_SECURE=callback.startswith("https://"),
                  SESSION_COOKIE_NAME="ancora_site_session",
                  PERMANENT_SESSION_LIFETIME=timedelta(minutes=30),
                  SESSION_REFRESH_EACH_REQUEST=False)
client = AncoraClient(app, issuer=os.environ["ANCORA_ISSUER"],
                      client_id=os.environ["ANCORA_CLIENT_ID"],
                      client_secret=os.environ["ANCORA_CLIENT_SECRET"],
                      redirect_uri=callback)

@app.get("/auth/login")
def login():
    return client.login()

@app.get(urlsplit(callback).path)
def finish():
    try:
        identity = client.callback()
    except (OAuthError, RequestException, ValueError):
        abort(400)
    session.clear()
    session.permanent = True
    session["ancora_identity"] = identity
    return redirect("/minha-conta", code=303)

@app.get("/minha-conta")
def account():
    if "ancora_identity" not in session:
        abort(401)
    return session["ancora_identity"]
```

Salve o código como app.py e inicie com python -m flask --app app run --host localhost --port PORTA. Abra /auth/login no endereço cadastrado. O exemplo usa o cookie assinado do Flask para guardar a identidade, sem gravar tokens nele. Em produção, use HTTPS, armazenamento de sessão no servidor se precisar de revogação e proteja as operações POST contra CSRF. Vincule a identidade ao usuário local pela combinação (issuer, sub).
