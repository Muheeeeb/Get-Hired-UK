import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineContentType } from './storage.js';

test('only inert types are served inline', () => {
  // Inline responses come from the API's own origin, so an active content type
  // here would mean same-origin script served on an uploader's behalf.
  assert.equal(inlineContentType('cv.pdf'), 'application/pdf');
  assert.equal(inlineContentType('notes.txt'), 'text/plain; charset=utf-8');
  assert.equal(inlineContentType('shot.png'), 'image/png');

  for (const active of ['page.html', 'page.htm', 'logo.svg', 'app.js', 'style.css', 'doc.xml']) {
    assert.equal(inlineContentType(active), null, `${active} must never render inline`);
  }
});

test('anything not explicitly listed downloads rather than rendering', () => {
  assert.equal(inlineContentType('cv.docx'), null);
  assert.equal(inlineContentType('archive.zip'), null);
  assert.equal(inlineContentType(''), null);
});
