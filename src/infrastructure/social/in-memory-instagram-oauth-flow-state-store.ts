import { randomBytes } from 'node:crypto';
import type { InstagramOAuthFlowStateStore } from '../../application/ports/instagram-oauth.port';

const stateLifetimeMilliseconds = 5 * 60 * 1000;

export class InMemoryInstagramOAuthFlowStateStore implements InstagramOAuthFlowStateStore {
  private readonly pending = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(): { readonly state: string } {
    this.removeExpired();
    const state = randomBytes(32).toString('base64url');
    this.pending.set(state, this.now() + stateLifetimeMilliseconds);
    return { state };
  }

  consume(state: string): boolean {
    const expiresAt = this.pending.get(state);
    this.pending.delete(state);
    return expiresAt !== undefined && expiresAt > this.now();
  }

  private removeExpired(): void {
    const now = this.now();
    for (const [state, expiresAt] of this.pending) {
      if (expiresAt <= now) this.pending.delete(state);
    }
  }
}
