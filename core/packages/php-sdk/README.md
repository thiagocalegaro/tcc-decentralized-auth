# Âncora para PHP

PHP 8.1+ com Composer e as extensões exigidas pelo OpenID-Connect-PHP. Extraia o arquivo em sdk-downloads/ancora-php dentro do seu projeto. Na raiz da aplicação, configure o repositório local com composer config repositories.ancora path ./sdk-downloads/ancora-php e depois composer require ancora/oidc:0.1.0.

Defina ANCORA_ISSUER, ANCORA_CLIENT_ID, ANCORA_CLIENT_SECRET e ANCORA_REDIRECT_URI no ambiente do servidor. O callback deve coincidir com o cadastrado no portal. Carregue o autoload do Composer e inicie a sessão antes de chamar o cliente. Exemplo de controlador para as duas rotas:

```php
<?php
require __DIR__ . '/vendor/autoload.php';

$callback = getenv('ANCORA_REDIRECT_URI');
session_name('ancora_php_session');
ini_set('session.use_strict_mode', '1');
session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax',
    'secure' => str_starts_with($callback, 'https://')]);
session_start();
$client = new Ancora\Client(
    getenv('ANCORA_ISSUER'), getenv('ANCORA_CLIENT_ID'),
    getenv('ANCORA_CLIENT_SECRET'), $callback,
);
try {
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if ($_SERVER['REQUEST_METHOD'] === 'GET' && $path === '/auth/login') {
        $client->login();
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'GET' || $path !== parse_url($callback, PHP_URL_PATH)) {
        http_response_code(404);
        exit;
    }
    $identity = $client->callback();
    if (session_status() !== PHP_SESSION_ACTIVE) session_start();
    if (!session_regenerate_id(true)) throw new RuntimeException('Sessão inválida');
    $_SESSION['ancora_identity'] = $identity;
    $_SESSION['ancora_expires'] = time() + 1800;
    header('Location: /minha-conta', true, 303);
} catch (Throwable $error) {
    http_response_code(400);
    echo 'Não foi possível entrar. Reinicie o login.';
}
```

Configure o servidor para encaminhar /auth/login e o caminho de callback ao controlador. Na página privada, abra a mesma sessão e exija identidade e validade antes de servir conteúdo. Use HTTPS em produção e valide CSRF nas operações que alteram estado. Vincule a conta local por (issuer, sub).
