<?php
declare(strict_types=1);

namespace Ancora;

use Jumbojett\OpenIDConnectClient;
use RuntimeException;

final class Client
{
    private OpenIDConnectClient $client;

    public function __construct(
        private readonly string $issuer,
        string $clientId,
        string $clientSecret,
        string $redirectUri,
    ) {
        self::validateUrl($issuer, true);
        self::validateUrl($redirectUri, false);
        if ($clientId === '' || $clientSecret === '') {
            throw new RuntimeException('Configure as credenciais do cliente.');
        }
        $this->client = new OpenIDConnectClient($issuer, $clientId, $clientSecret);
        $this->client->setRedirectURL($redirectUri);
        $this->client->addScope('wallet');
        $this->client->setCodeChallengeMethod('S256');
    }

    private static function validateUrl(string $url, bool $issuer): void
    {
        $parts = parse_url($url);
        if (!$parts || empty($parts['host']) || isset($parts['user']) || isset($parts['pass'])
            || isset($parts['query']) || isset($parts['fragment']) || str_contains($url, '\\')
            || ($issuer ? isset($parts['path']) : empty($parts['path']))
            || (($parts['scheme'] ?? '') !== 'https' && !(($parts['scheme'] ?? '') === 'http'
                && in_array($parts['host'], ['localhost', '127.0.0.1', '[::1]'], true)))) {
            throw new RuntimeException('Configure uma URL HTTPS ou HTTP em loopback.');
        }
    }

    public function login(): never
    {
        if (isset($_REQUEST['code']) || isset($_REQUEST['state']) || isset($_REQUEST['error'])) {
            throw new RuntimeException('Use a rota de retorno para concluir o login.');
        }
        $this->client->authenticate();
        throw new RuntimeException('Não foi possível iniciar o login.');
    }

    public function callback(): array
    {
        if (!is_string($_GET['code'] ?? null) || $_GET['code'] === ''
            || !is_string($_GET['state'] ?? null) || $_GET['state'] === ''
            || isset($_GET['error']) || !$this->client->authenticate()) {
            throw new RuntimeException('Retorno de autenticação inválido.');
        }
        $claims = $this->client->getVerifiedClaims();
        $profile = $this->client->requestUserInfo();
        $address = $profile->wallet_address ?? null;
        $chain = $profile->chain_id ?? null;
        $subject = $claims->sub ?? null;
        if (($claims->iss ?? null) !== $this->issuer || !is_string($address)
            || !preg_match('/\A0x[0-9a-fA-F]{40}\z/', $address)
            || !is_int($chain) || $chain < 1 || $chain > 9007199254740991
            || $subject !== 'eip155:' . $chain . ':' . strtolower($address)
            || ($profile->sub ?? null) !== $subject) {
            throw new RuntimeException('Identidade de carteira inválida.');
        }
        return ['issuer' => $this->issuer, 'sub' => $subject, 'address' => $address, 'chainId' => $chain];
    }
}
