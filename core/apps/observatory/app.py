"""Observatório: independent Flask application using Authlib's OIDC client."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import time
from urllib.parse import urlencode, urlsplit
from uuid import uuid4

from authlib.integrations.flask_client import OAuth
from flask import Flask, abort, g, jsonify, redirect, request, send_from_directory, session


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def create_app(settings, database):
    app = Flask(__name__, static_folder=None)
    root = Path(__file__).resolve().parents[3]
    suffix = digest(settings['clientId'])[:12]
    secure = settings['appUrl'].startswith('https:')
    cookie = ('__Host-' if secure else '') + 'ancora_' + suffix
    cookie_options = dict(httponly=True, secure=secure, samesite='Lax', path='/')
    app.config.update(
        SECRET_KEY=digest('observatory-flow:' + settings['clientSecret']),
        SESSION_COOKIE_NAME='ancora_python_flow_' + suffix,
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax',
        SESSION_COOKIE_SECURE=secure, MAX_CONTENT_LENGTH=16384,
    )

    def db():
        if 'db' not in g:
            g.db = sqlite3.connect(database, timeout=5)
            g.db.row_factory = sqlite3.Row
        return g.db

    @app.teardown_appcontext
    def close_db(_error):
        connection = g.pop('db', None)
        if connection is not None:
            connection.close()

    with app.app_context():
        db().executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS records (
                namespace TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
                expires INTEGER NOT NULL, PRIMARY KEY(namespace,id));
            CREATE INDEX IF NOT EXISTS record_expiry ON records(expires);
            CREATE TABLE IF NOT EXISTS python_rate_limits (
                ip TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS app_users (
                id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL,
                address TEXT NOT NULL, chain_id INTEGER NOT NULL, created_at INTEGER NOT NULL,
                UNIQUE(issuer,subject));
        ''')

    def put(namespace, key, value, expires):
        with db():
            db().execute('INSERT OR REPLACE INTO records VALUES(?,?,?,?)',
                         (namespace, key, json.dumps(value), expires))

    def remove(namespace, key):
        with db():
            db().execute('DELETE FROM records WHERE namespace=? AND id=?', (namespace, key))

    class FlowCache:
        # Bind Authlib state to a browser cookie and consume it atomically.
        def key(self, key):
            return digest(session.get('binding', '') + ':' + key)

        def set(self, key, value, timeout=300):
            put('python-flow', self.key(key), value, (time.time() + min(timeout, 300)) * 1000)

        def get(self, key):
            with db():
                row = db().execute('DELETE FROM records WHERE namespace=? AND id=? AND expires>? RETURNING payload',
                                   ('python-flow', self.key(key), time.time() * 1000)).fetchone()
            return json.loads(row['payload']) if row else None

        def delete(self, key):
            remove('python-flow', self.key(key))

    oauth = OAuth(app, cache=FlowCache())
    ancora = oauth.register(
        'ancora', client_id=settings['clientId'], client_secret=settings['clientSecret'],
        server_metadata_url=settings['issuer'] + '/.well-known/openid-configuration',
        client_kwargs={'scope': 'openid wallet', 'code_challenge_method': 'S256',
                       'token_endpoint_auth_method': 'client_secret_post', 'timeout': 10},
    )

    def identity():
        now = time.time() * 1000
        key = digest(request.cookies.get(cookie, ''))
        with db():
            # Updating only an existing row prevents a concurrent logout from being undone.
            row = db().execute('''UPDATE records
                SET payload=json_set(payload,'$.idleExpiresAt',min(?,expires))
                WHERE namespace='session' AND id=? AND expires>?
                AND json_extract(payload,'$.idleExpiresAt')>?
                RETURNING payload''', (now + 1800000, key, now, now)).fetchone()
        if not row:
            return None
        user = json.loads(row['payload'])
        user.pop('idleExpiresAt', None)
        return user

    @app.before_request
    def limit_auth():
        if not request.path.startswith('/auth/'):
            return None
        window = int(time.time() // 60)
        with db():
            db().execute('DELETE FROM python_rate_limits WHERE window<?', (window,))
            row = db().execute('''INSERT INTO python_rate_limits VALUES(?,?,1)
                ON CONFLICT(ip) DO UPDATE SET count=count+1 RETURNING count''',
                (request.remote_addr, window)).fetchone()
        if row['count'] > 90:
            return jsonify(error='Muitas solicitações. Tente novamente em um minuto.'), 429
        return None

    @app.after_request
    def headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer' if request.path == '/auth/callback' else 'same-origin'
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
            "frame-ancestors 'none'; base-uri 'none'; form-action 'self' " + settings['issuer'])
        return response

    @app.get('/auth/login')
    def login():
        session.clear()
        session['binding'] = secrets.token_urlsafe(32)
        with db():
            db().execute('DELETE FROM records WHERE expires<=?', (time.time() * 1000,))
        return ancora.authorize_redirect(settings['appUrl'] + '/auth/callback')

    @app.get('/auth/callback')
    def callback():
        try:
            if request.args.get('error'):
                state = request.args.get('state')
                data = ancora.framework.get_state_data(session, state)
                if not data or request.args['error'] != 'access_denied':
                    abort(400)
                session.clear()
                return redirect('/?login=cancelled', 303)
            token = ancora.authorize_access_token()
            claims = token['userinfo']
            profile = ancora.userinfo(token=token)
            if claims['iss'] != settings['issuer'] or profile['sub'] != claims['sub']:
                abort(400)
            now = int(time.time() * 1000)
            with db():
                db().execute('''INSERT INTO app_users VALUES(?,?,?,?,?,?)
                    ON CONFLICT(issuer,subject) DO UPDATE SET
                    address=excluded.address,chain_id=excluded.chain_id''',
                    (str(uuid4()), claims['iss'], claims['sub'], profile['wallet_address'], profile['chain_id'], now))
                local = db().execute('SELECT id FROM app_users WHERE issuer=? AND subject=?',
                                     (claims['iss'], claims['sub'])).fetchone()
            user = dict(issuer=claims['iss'], sub=claims['sub'], address=profile['wallet_address'],
                        chainId=profile['chain_id'], userId=local['id'],
                        expiresAt=now + 28800000, idleExpiresAt=now + 1800000)
            remove('session', digest(request.cookies.get(cookie, '')))
            sid = secrets.token_urlsafe(32)
            put('session', digest(sid), user, user['expiresAt'])
            session.clear()
            response = redirect('/arearestrita', 303)
            response.set_cookie(cookie, sid, max_age=28800, **cookie_options)
            return response
        except Exception:
            # Callback URLs, codes, tokens and signatures must stay out of logs.
            session.clear()
            return jsonify(error='Não foi possível entrar. Inicie o login novamente.'), 400

    @app.post('/auth/logout')
    @app.post('/auth/logout-provider')
    def logout():
        if request.headers.get('Origin') != settings['appUrl']:
            abort(403)
        current = identity()
        destination = '/'
        if request.path.endswith('logout-provider') and current:
            metadata = ancora.load_server_metadata()
            destination = metadata['end_session_endpoint'] + '?' + urlencode(
                dict(client_id=settings['clientId'], post_logout_redirect_uri=settings['appUrl'] + '/'))
        remove('session', digest(request.cookies.get(cookie, '')))
        session.clear()
        response = redirect(destination, 303)
        response.delete_cookie(cookie, **cookie_options)
        return response

    @app.get('/api/session')
    def session_info():
        user = identity()
        return jsonify(authenticated=True, user=user) if user else jsonify(authenticated=False)

    @app.get('/api/private')
    def private():
        user = identity()
        if not user:
            return jsonify(error='Autenticação necessária.'), 401
        return jsonify(message=f"Você acessou o conteúdo protegido de {settings['name']}.",
                       user=user, application=settings['clientId'])

    @app.get('/arearestrita')
    def restricted():
        return send_from_directory(root / 'frontend/demo', 'restricted.html') if identity() else redirect('/', 303)

    @app.get('/')
    def index():
        return send_from_directory(root / 'frontend/demo', 'index.html')

    @app.get('/api/config')
    def config():
        return jsonify({key: settings[key] for key in ('name', 'theme', 'peerUrl', 'issuer')})

    @app.get('/health')
    def health():
        return jsonify(status='ok', service=settings['clientId'], runtime='python-flask')

    @app.get('/assets/<path:filename>')
    def assets(filename):
        return send_from_directory(root / 'frontend/shared', filename)

    @app.get('/demo-assets/<filename>')
    def demo_assets(filename):
        if filename not in ('main.js', 'main.css'):
            abort(404)
        return send_from_directory(root / 'frontend/demo', filename)

    return app


if __name__ == '__main__':
    import logging
    from werkzeug.serving import make_server, WSGIRequestHandler

    class QuietHandler(WSGIRequestHandler):
        def log_request(self, code='-', size='-'):
            pass  # Requests may contain authorization codes.

    os.umask(0o077)
    directory = Path(os.environ['ANCORA_DATA_DIR'])
    settings = json.loads((directory / 'demo-b.json').read_text(encoding='utf-8'))
    host = os.environ.get('ANCORA_BIND_HOST', '127.0.0.1')
    if host not in ('127.0.0.1', '0.0.0.0') or os.environ.get('NODE_ENV') == 'production':
        raise RuntimeError('O Observatório é uma demonstração local.')
    app = create_app(settings, directory / settings['database'])
    server = make_server(host, urlsplit(settings['appUrl']).port, app, threaded=True, request_handler=QuietHandler)
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    print('Observatório Flask pronto', flush=True)
    server.serve_forever()
