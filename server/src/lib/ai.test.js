import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttachmentBlocks, buildClaudeRequest, resolveEffort } from './ai.js';

test('Claude request uses fields supported by Sonnet 5', () => {
  const request = buildClaudeRequest({
    model: 'claude-sonnet-5',
    messages: [{ role: 'user', content: 'Hello' }],
    maxTokens: 100,
  });

  assert.deepEqual(request, {
    model: 'claude-sonnet-5',
    max_tokens: 100,
    // Thinking is on by default, as it is in the Claude apps — and asked for
    // explicitly, because omitting it means "no thinking" on this model.
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: 'high' },
    messages: [{ role: 'user', content: 'Hello' }],
  });
  // Both were removed from the current models and 400 rather than being ignored.
  assert.equal('temperature' in request, false);
  assert.equal('budget_tokens' in request.thinking, false);
});

test('the reasoning summary is asked for — the default would return empty thinking', () => {
  const request = buildClaudeRequest({
    model: 'claude-opus-5', messages: [], maxTokens: 10,
  });
  assert.equal(request.thinking.display, 'summarized');
});

test('effort rides inside output_config, where the API reads it', () => {
  const request = buildClaudeRequest({
    model: 'claude-opus-5', messages: [], maxTokens: 10, effort: 'low',
  });
  assert.deepEqual(request.output_config, { effort: 'low' });
  assert.equal('effort' in request, false);
});

test('models without adaptive thinking are left exactly as they were', () => {
  // Haiku 4.5 and the Claude 3 line take the retired budget_tokens form, so
  // sending either field would fail the request outright.
  for (const model of ['claude-haiku-4-5', 'claude-3-5-sonnet-20241022']) {
    const request = buildClaudeRequest({ model, messages: [], maxTokens: 10, effort: 'xhigh' });
    assert.equal('thinking' in request, false, model);
    assert.equal('output_config' in request, false, model);
  }
});

test('xhigh is downgraded on models that never had it, not sent and rejected', () => {
  assert.equal(resolveEffort('claude-sonnet-4-6', 'xhigh'), 'high');
  assert.equal(resolveEffort('claude-opus-4-6', 'xhigh'), 'high');
  assert.equal(resolveEffort('claude-opus-5', 'xhigh'), 'xhigh');
  assert.equal(resolveEffort('claude-sonnet-5', 'xhigh'), 'xhigh');
});

test('an unrecognised effort falls back to the default instead of failing the turn', () => {
  assert.equal(resolveEffort('claude-opus-5', 'turbo'), 'high');
  assert.equal(resolveEffort('claude-opus-5', undefined), 'high');
});

test('a model newer than this code keeps the newest tools, not the oldest', () => {
  // The dropdown is filled from /v1/models, so ids this file has never seen do
  // turn up. Guessing "old" for them would quietly downgrade the whole studio.
  const request = buildClaudeRequest({
    model: 'claude-opus-7-2', messages: [], maxTokens: 10, webTools: true, effort: 'xhigh',
  });
  assert.equal(request.tools[0].type, 'web_search_20260209');
  assert.deepEqual(request.output_config, { effort: 'xhigh' });
});

test('web tools are declared — without them Claude cannot browse at all', () => {
  const request = buildClaudeRequest({
    model: 'claude-opus-5', messages: [], maxTokens: 10, webTools: true,
  });
  assert.deepEqual(request.tools.map((t) => t.name), ['web_search', 'web_fetch']);
  assert.deepEqual(request.tools.map((t) => t.type), ['web_search_20260209', 'web_fetch_20260209']);
});

test('older models get the tool variants they actually support', () => {
  const request = buildClaudeRequest({
    model: 'claude-haiku-4-5', messages: [], maxTokens: 10, webTools: true,
  });
  assert.deepEqual(request.tools.map((t) => t.type), ['web_search_20250305', 'web_fetch_20250910']);
});

test('no tools are declared unless the caller asks for them', () => {
  const request = buildClaudeRequest({ model: 'claude-opus-5', messages: [], maxTokens: 10 });
  assert.equal('tools' in request, false);
});

test('the tool list is byte-identical between turns, so the cached prefix survives', () => {
  // tools render ahead of system; anything varying here costs the master-prompt
  // cache on every single turn of every chat.
  const first = buildClaudeRequest({
    model: 'claude-opus-5', messages: [{ role: 'user', content: 'a' }], maxTokens: 10, webTools: true,
  });
  const second = buildClaudeRequest({
    model: 'claude-opus-5', messages: [{ role: 'user', content: 'b' }], maxTokens: 10, webTools: true,
  });
  assert.equal(JSON.stringify(first.tools), JSON.stringify(second.tools));
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
  const big = Buffer.alloc(4 * 1024 * 1024, 0x41);
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
  const big = Buffer.alloc(4 * 1024 * 1024, 0x41);
  const blocks = buildAttachmentBlocks([
    { name: 'a.pdf', pdf: big, text: 'A' },
    { name: 'b.pdf', pdf: big, text: 'B' },
    { name: 'scan.pdf', pdf: big, text: '' },
  ]);

  assert.deepEqual(blocks.map((b) => b.type), ['document', 'document']);
  assert.deepEqual(blocks.skipped, ['scan.pdf']);
});
