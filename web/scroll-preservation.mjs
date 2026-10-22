export function replaceHtmlPreservingScroll(container, html, getScrollTarget = () => container) {
  const scrollTop = getScrollTarget()?.scrollTop;
  container.innerHTML = html;
  if (typeof scrollTop !== 'number') return;
  const nextScrollTarget = getScrollTarget();
  if (nextScrollTarget) nextScrollTarget.scrollTop = scrollTop;
}
