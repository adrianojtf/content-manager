import { randomBytes } from 'node:crypto';
import type { ConsumedYouTubeOAuthFlow, YouTubeOAuthFlow, YouTubeOAuthFlowStateStore, YouTubeOAuthScope } from '../../application/ports/youtube-oauth.port';

interface PendingFlow {
  readonly codeVerifier: string;
  readonly scopes: readonly YouTubeOAuthScope[];
  readonly expiresAt: number;
}

const stateLifetimeMilliseconds = 5 * 60 * 1000;

export class InMemoryYouTubeOAuthFlowStateStore implements YouTubeOAuthFlowStateStore {
  private readonly pending = new Map<string, PendingFlow>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(scopes: readonly YouTubeOAuthScope[]): YouTubeOAuthFlow {
    this.removeExpired();
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    this.pending.set(state, { codeVerifier, scopes: [...scopes], expiresAt: this.now() + stateLifetimeMilliseconds });
    return { state, codeVerifier, scopes: [...scopes] };
  }

  consume(state: string): ConsumedYouTubeOAuthFlow | null {
    const flow = this.pending.get(state);
    this.pending.delete(state);
    if (!flow || flow.expiresAt <= this.now()) {
      return null;
    }
    return { codeVerifier: flow.codeVerifier, scopes: flow.scopes };
  }

  private removeExpired(): void {
    const now = this.now();
    for (const [state, flow] of this.pending) {
      if (flow.expiresAt <= now) {
        this.pending.delete(state);
      }
    }
  }
}
