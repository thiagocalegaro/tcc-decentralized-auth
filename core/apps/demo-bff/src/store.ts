import { timingSafeEqual } from 'node:crypto';

export const FLOW_LIFETIME_MS = 5 * 60_000;
export const SESSION_IDLE_MS = 30 * 60_000;
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60_000;

export interface SessionUser {
  accountId: string;
  address: string;
  chainId: number;
}

export interface LoginFlow {
  id: string;
  cookieHash: string;
  codeVerifier: string;
  expiresAt: number;
}

export interface Session {
  tokenHash: string;
  user: SessionUser;
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
}

/** Implementations must perform consumeFlow and createSession atomically. */
export interface BffStore {
  createFlow(flow: LoginFlow, now: number): Promise<void>;
  consumeFlow(id: string, cookieHash: string, now: number): Promise<LoginFlow | null>;
  deleteFlowsByCookie(cookieHash: string): Promise<void>;
  createSession(session: Session, assertionId: string, assertionExpiry: number,
    previousTokenHash: string | null, now: number, flowId: string): Promise<boolean>;
  getAndTouchSession(tokenHash: string, now: number): Promise<Session | null>;
  deleteSession(tokenHash: string): Promise<void>;
  cleanup(now: number): Promise<void>;
}

export class StoreCapacityError extends Error {}
export class FlowCancelledError extends Error {}

/** Single-process demo store. A process restart invalidates all sessions and flows. */
export class MemoryBffStore implements BffStore {
  private readonly flows = new Map<string, LoginFlow & { claimed?: boolean }>();
  private readonly sessions = new Map<string, Session>();
  private readonly assertions = new Map<string, number>();

  constructor(private readonly maxSessions = 10_000, private readonly maxFlows = 1_000) {}

  private sweep(now: number): void {
    for (const [id, flow] of this.flows) if (flow.expiresAt <= now) this.flows.delete(id);
    for (const [id, session] of this.sessions) {
      if (session.absoluteExpiresAt <= now || session.lastSeenAt + SESSION_IDLE_MS <= now) {
        this.sessions.delete(id);
      }
    }
    for (const [id, expiry] of this.assertions) if (expiry <= now) this.assertions.delete(id);
  }

  async cleanup(now: number): Promise<void> { this.sweep(now); }

  async createFlow(flow: LoginFlow, now: number): Promise<void> {
    this.sweep(now);
    if (this.flows.size >= this.maxFlows) throw new StoreCapacityError();
    this.flows.set(flow.id, { ...flow });
  }

  async consumeFlow(id: string, cookieHash: string, now: number): Promise<LoginFlow | null> {
    this.sweep(now);
    const flow = this.flows.get(id);
    if (!flow || flow.claimed || !equalHash(flow.cookieHash, cookieHash)) return null;
    // Keep the claimed entry until session creation. Logout/new start can still revoke it.
    // No await between validation and claim: concurrent completes cannot share one flow.
    flow.claimed = true;
    return { ...flow };
  }

  async deleteFlowsByCookie(cookieHash: string): Promise<void> {
    for (const [id, flow] of this.flows) {
      if (equalHash(flow.cookieHash, cookieHash)) this.flows.delete(id);
    }
  }

  async createSession(session: Session, assertionId: string, assertionExpiry: number,
    previousTokenHash: string | null, now: number, flowId: string): Promise<boolean> {
    this.sweep(now);
    const flow = this.flows.get(flowId);
    if (!flow?.claimed) throw new FlowCancelledError();
    if (this.assertions.has(assertionId)) return false;
    const replacing = previousTokenHash !== null && this.sessions.has(previousTokenHash);
    if ((!replacing && this.sessions.size >= this.maxSessions) || this.assertions.size >= this.maxSessions * 2) {
      throw new StoreCapacityError();
    }
    if (previousTokenHash) this.sessions.delete(previousTokenHash);
    this.flows.delete(flowId);
    this.assertions.set(assertionId, assertionExpiry);
    this.sessions.set(session.tokenHash, { ...session, user: { ...session.user } });
    return true;
  }

  async getAndTouchSession(tokenHash: string, now: number): Promise<Session | null> {
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    if (session.absoluteExpiresAt <= now || session.lastSeenAt + SESSION_IDLE_MS <= now) {
      this.sessions.delete(tokenHash);
      return null;
    }
    session.lastSeenAt = now;
    return { ...session, user: { ...session.user } };
  }

  async deleteSession(tokenHash: string): Promise<void> { this.sessions.delete(tokenHash); }
}

function equalHash(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
