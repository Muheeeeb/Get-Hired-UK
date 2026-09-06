import test from 'node:test';
import assert from 'node:assert/strict';
import {
  default as router,
  MAX_AI_HISTORY_JSON_CHARS,
  MAX_AI_PROMPT_CHARS,
  parseConversationHistory,
} from './ai.routes.js';
import { buildDocumentUserContent } from '../lib/ai.js';

test('AI Studio accepts substantial CV prompts beyond the former 6,000-character ceiling', () => {
  assert.equal(MAX_AI_PROMPT_CHARS, 50_000);
  assert.ok(MAX_AI_HISTORY_JSON_CHARS >= 500_000);

  const pastedCv = 'A'.repeat(20_000);
  const content = buildDocumentUserContent({ prompt: pastedCv, isFollowUp: false });
  assert.equal(content.length, pastedCv.length + 'Instructions:\n'.length);
  assert.ok(content.endsWith(pastedCv));
});

test('follow-up history keeps a complete realistic CV and the latest instruction', () => {
  const cv = 'Detailed CV content. '.repeat(1_000);
  const history = parseConversationHistory(JSON.stringify([
    { role: 'user', content: 'Write a CV' },
    { role: 'assistant', content: cv },
    { role: 'user', content: 'Make it shorter without losing achievements' },
  ]));

  assert.equal(history[1].content, cv);
  assert.equal(history.at(-1).content, 'Make it shorter without losing achievements');
});

test('conversation history is bounded from the oldest side', () => {
  const history = parseConversationHistory(JSON.stringify(
    Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i).repeat(20_000) })),
  ));
  const total = history.reduce((sum, message) => sum + message.content.length, 0);
  assert.ok(total <= 240_000);
  assert.ok(history.at(-1).content.startsWith('29'));
});

function roleGate(path) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods.post);
  assert.ok(layer, `POST ${path} route exists`);
  return layer.route.stack[1].handle;
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

for (const path of ['/generate', '/export']) {
  test(`POST ${path} allows employees`, () => {
    let continued = false;
    roleGate(path)({ user: { role: 'employee' } }, responseRecorder(), () => { continued = true; });
    assert.equal(continued, true);
  });

  test(`POST ${path} rejects clients`, () => {
    const res = responseRecorder();
    roleGate(path)({ user: { role: 'client' } }, res, () => {});
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Forbidden' });
  });
}
