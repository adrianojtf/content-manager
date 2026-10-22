import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceHtmlPreservingScroll } from '../../web/scroll-preservation.mjs';

test('replacing the semi-automatic dialog restores its internal scroll position', () => {
  let content = { scrollTop: 560 };
  const dialog = {
    set innerHTML(value) {
      this.html = value;
      content = { scrollTop: 0 };
    },
    querySelector: () => content,
  };

  replaceHtmlPreservingScroll(dialog, '<section>updated</section>', () => dialog.querySelector('.bulk-dialog-content'));

  assert.equal(dialog.html, '<section>updated</section>');
  assert.equal(content.scrollTop, 560);
});

test('replacing comment content restores the document scroll position', () => {
  const documentScroller = { scrollTop: 740 };
  const contentList = {
    set innerHTML(value) {
      this.html = value;
      documentScroller.scrollTop = 0;
    },
  };

  replaceHtmlPreservingScroll(contentList, '<article>updated</article>', () => documentScroller);

  assert.equal(contentList.html, '<article>updated</article>');
  assert.equal(documentScroller.scrollTop, 740);
});
