-- Run with core/packages/storage/src/migrate.ts, which owns BEGIN/COMMIT and a migration ledger.
-- Every time field is Unix milliseconds, matching the TypeScript contract.
CREATE TABLE IF NOT EXISTS auth_challenges (
  id text PRIMARY KEY,
  client_id text NOT NULL,
  address text NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id > 0 AND chain_id <= 9007199254740991),
  origin text NOT NULL,
  redirect_uri text NOT NULL,
  message_hash text NOT NULL,
  nonce_hash text NOT NULL,
  code_challenge text NOT NULL,
  created_at bigint NOT NULL CHECK (created_at >= 0 AND created_at <= 9007199254740991),
  expires_at bigint NOT NULL CHECK (expires_at > created_at AND expires_at <= 9007199254740991)
);

CREATE INDEX IF NOT EXISTS auth_challenges_expires_at_idx ON auth_challenges (expires_at);

CREATE TABLE IF NOT EXISTS auth_authorization_codes (
  code_hash text PRIMARY KEY,
  -- No foreign key: successful verification consumes/deletes the source challenge.
  challenge_id text NOT NULL UNIQUE,
  client_id text NOT NULL,
  account_id text NOT NULL,
  address text NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id > 0 AND chain_id <= 9007199254740991),
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  auth_time bigint NOT NULL CHECK (auth_time >= 0 AND auth_time <= 9007199254740991),
  expires_at bigint NOT NULL CHECK (expires_at > auth_time AND expires_at <= 9007199254740991)
);

CREATE INDEX IF NOT EXISTS auth_codes_expires_at_idx ON auth_authorization_codes (expires_at);
