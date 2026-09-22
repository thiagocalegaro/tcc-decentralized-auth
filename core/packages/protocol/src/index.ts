export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const CODE_TTL_MS = 60 * 1000;
export const ASSERTION_TTL_SECONDS = 60;

export interface ChallengeRequest {
  clientId: string;
  address: string;
  chainId: number;
  redirectUri: string;
  codeChallenge: string;
}
export interface ChallengeResponse {
  challengeId: string;
  message: string;
  expiresAt: string;
}
export interface VerificationRequest { challengeId: string; message: string; signature: string }
export interface VerificationResponse { code: string; expiresIn: number }
export interface ExchangeRequest {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}
export interface WalletIdentity { address: string; chainId: number; type: 'eoa' }
export interface SessionUser { accountId: string; address: string; chainId: number }
export type SessionResponse = { authenticated: false } | {
  authenticated: true;
  user: SessionUser;
  expiresAt: string;
};
