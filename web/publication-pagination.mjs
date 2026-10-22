export const publicationPageSizes = Object.freeze([5, 10, 25]);
export const defaultPublicationPageSize = publicationPageSizes[0];

export function isPublicationPageSize(value) {
  return publicationPageSizes.includes(Number(value)) && String(Number(value)) === String(value);
}

export function publicationPageRequest({ direction, pageIndex, cursors, nextCursor }) {
  if (direction === 'next' && nextCursor) {
    return { pageIndex: pageIndex + 1, cursor: nextCursor };
  }
  if (direction === 'previous' && pageIndex > 0) {
    return { pageIndex: pageIndex - 1, cursor: cursors[pageIndex - 1] };
  }
  return null;
}

export function recordPublicationPageCursor(cursors, pageIndex, cursor) {
  const history = cursors.slice(0, pageIndex);
  history[pageIndex] = cursor;
  return history;
}
