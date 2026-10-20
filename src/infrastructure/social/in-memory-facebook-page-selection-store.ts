import { randomBytes } from 'node:crypto';
import type { FacebookPageCandidate } from '../../application/ports/facebook-oauth.port';

export interface PendingFacebookPageSelection {
  readonly tenantId: string;
  readonly credentialReference: string;
  readonly grantedScopes: readonly string[];
  readonly pages: readonly FacebookPageCandidate[];
}

interface StoredPageSelection extends PendingFacebookPageSelection {
  readonly expiresAt: number;
}

const selectionLifetimeMilliseconds = 5 * 60 * 1000;

export class InMemoryFacebookPageSelectionStore {
  private readonly pending = new Map<string, StoredPageSelection>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(selection: PendingFacebookPageSelection): string {
    this.removeExpired();
    const selectionId = randomBytes(32).toString('base64url');
    this.pending.set(selectionId, { ...selection, pages: [...selection.pages], grantedScopes: [...selection.grantedScopes], expiresAt: this.now() + selectionLifetimeMilliseconds });
    return selectionId;
  }

  consume(selectionId: string, tenantId: string, pageId: string): PendingFacebookPageSelection | null {
    const selection = this.pending.get(selectionId);
    if (!selection || selection.expiresAt <= this.now() || selection.tenantId !== tenantId
      || !selection.pages.some((page) => page.externalAccountId === pageId)) {
      if (selection?.expiresAt && selection.expiresAt <= this.now()) this.pending.delete(selectionId);
      return null;
    }
    this.pending.delete(selectionId);
    return selection;
  }

  private removeExpired(): void {
    const now = this.now();
    for (const [selectionId, selection] of this.pending) {
      if (selection.expiresAt <= now) this.pending.delete(selectionId);
    }
  }
}
