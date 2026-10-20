import { ContentId, parseContentId } from './content-id';
import { ContentInvariantError } from './content-invariant-error';

export type ContentStatus = 'draft' | 'ready';

export interface ContentInput {
  readonly id: ContentId;
  readonly tenantId: string;
  readonly title: string;
  readonly description: string;
  readonly mediaReference: string;
}

export interface StoredContent extends ContentInput {
  readonly status: string;
}

export class Content {
  private constructor(
    readonly id: ContentId,
    readonly tenantId: string,
    private currentTitle: string,
    private currentDescription: string,
    readonly mediaReference: string,
    private currentStatus: ContentStatus,
  ) {}

  static create(input: ContentInput): Content {
    return new Content(
      parseContentId(input.id),
      this.requiredText(input.tenantId, 'CONTENT_TENANT_REQUIRED'),
      this.requiredText(input.title, 'CONTENT_TITLE_REQUIRED'),
      this.requiredText(input.description, 'CONTENT_DESCRIPTION_REQUIRED'),
      this.requiredText(input.mediaReference, 'CONTENT_MEDIA_REFERENCE_REQUIRED', false),
      'draft',
    );
  }

  static restore(input: StoredContent): Content {
    if (input.status !== 'draft' && input.status !== 'ready') {
      throw new ContentInvariantError('CONTENT_STATE_INVALID');
    }

    return new Content(
      parseContentId(input.id),
      this.requiredText(input.tenantId, 'CONTENT_TENANT_REQUIRED'),
      this.requiredText(input.title, 'CONTENT_TITLE_REQUIRED'),
      this.requiredText(input.description, 'CONTENT_DESCRIPTION_REQUIRED'),
      this.requiredText(input.mediaReference, 'CONTENT_MEDIA_REFERENCE_REQUIRED', false),
      input.status,
    );
  }

  get title(): string {
    return this.currentTitle;
  }

  get description(): string {
    return this.currentDescription;
  }

  get status(): ContentStatus {
    return this.currentStatus;
  }

  get isPublishable(): boolean {
    return this.currentStatus === 'ready' && this.mediaReference.trim().length > 0;
  }

  updateEditorialMetadata(title: string, description: string): void {
    const nextTitle = Content.requiredText(title, 'CONTENT_TITLE_REQUIRED');
    const nextDescription = Content.requiredText(description, 'CONTENT_DESCRIPTION_REQUIRED');
    this.currentTitle = nextTitle;
    this.currentDescription = nextDescription;
  }

  markReady(): void {
    this.currentStatus = 'ready';
  }

  markDraft(): void {
    this.currentStatus = 'draft';
  }

  private static requiredText(value: string, code: 'CONTENT_TENANT_REQUIRED' | 'CONTENT_TITLE_REQUIRED' | 'CONTENT_DESCRIPTION_REQUIRED' | 'CONTENT_MEDIA_REFERENCE_REQUIRED', trim = true): string {
    const normalized = trim ? value.trim() : value;
    if (normalized.trim().length === 0) {
      throw new ContentInvariantError(code);
    }
    return normalized;
  }
}
