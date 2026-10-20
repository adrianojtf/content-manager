import { ContentInvariantError } from './content-invariant-error';

export type ContentId = string & { readonly __contentId: unique symbol };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseContentId(value: string): ContentId {
  if (!uuidPattern.test(value)) {
    throw new ContentInvariantError('CONTENT_ID_INVALID');
  }

  return value.toLowerCase() as ContentId;
}
