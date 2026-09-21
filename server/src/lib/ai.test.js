import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttachmentBlocks, buildClaudeRequest } from './ai.js';

test('Claude request uses fields supported by Sonnet 5', () => {
  const request = buildClaudeRequest({
    model: 'claude-sonnet-5',
    messages: [{ role: 'user', content: 'Hello' }],
    maxTokens: 100,
  });

  assert.deepEqual(request, {
    model: 'claude-sonnet-5',
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 100,
  });
  assert.equal('temperature' in request, false);
});

test('no system prompt is sent unless an admin saved a master prompt', () => {
  const plain = buildClaudeRequest({
    model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'Hi' }], maxTokens: 10,
  });
  assert.equal('system' in plain, false);
});

test('the master prompt is cached for an hour so later job descriptions are cheap', () => {
  const request = buildClaudeRequest({
    model: 'claude-sonnet-5',
    system: 'Master prompt text',
    messages: [{ role: 'user', content: 'Job description' }],
    maxTokens: 10,
  });

  assert.deepEqual(request.system, [{
    type: 'text',
    text: 'Master prompt text',
    cache_control: { type: 'ephemeral', ttl: '1h' },
  }]);
});

test('PDF references become native document blocks, other files become text', () => {
  const blocks = buildAttachmentBlocks([
    { name: 'cv.pdf', pdf: Buffer.from('%PDF-1.7'), text: 'extracted' },
    { name: 'notes.docx', text: 'Word content' },
  ]);

  assert.equal(blocks[0].type, 'document');
  assert.equal(blocks[0].source.media_type, 'application/pdf');
  assert.equal(blocks[0].source.data, Buffer.from('%PDF-1.7').toString('base64'));
  assert.equal(blocks[1].type, 'text');
  assert.match(blocks[1].text, /<document name="notes.docx">/);
});

test('oversized PDFs fall back to extracted text instead of blowing the 32MB request cap', () => {
  const huge = Buffer.alloc(11 * 1024 * 1024, 0x41);
  const blocks = buildAttachmentBlocks([{ name: 'huge.pdf', pdf: huge, text: 'fallback text' }]);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'text');
  assert.match(blocks[0].text, /fallback text/);
});

test('the per-turn PDF budget is spent in order, later PDFs degrade to text', () => {
  const big = Buffer.alloc(7 * 1024 * 1024, 0x41);
  const blocks = buildAttachmentBlocks([
    { name: 'a.pdf', pdf: big, text: 'A' },
    { name: 'b.pdf', pdf: big, text: 'B' },
    { name: 'c.pdf', pdf: big, text: 'C' },
  ]);

  assert.deepEqual(blocks.map((b) => b.type), ['document', 'document', 'text']);
  assert.deepEqual(blocks.skipped, []);
});

test('a file that can be neither sent natively nor extracted is reported, not dropped', () => {
  // A big scanned PDF: past the per-turn budget and with no extractable text.
  const big = Buffer.alloc(7 * 1024 * 1024, 0x41);
  const blocks = buildAttachmentBlocks([
    { name: 'a.pdf', pdf: big, text: 'A' },
    { name: 'b.pdf', pdf: big, text: 'B' },
    { name: 'scan.pdf', pdf: big, text: '' },
  ]);

  assert.deepEqual(blocks.map((b) => b.type), ['document', 'document']);
  assert.deepEqual(blocks.skipped, ['scan.pdf']);
});
