import test from 'node:test';
import assert from 'node:assert/strict';
import {
  default as router,
  MAX_AI_HISTORY_JSON_CHARS,
  MAX_AI_PROMPT_CHARS,
  MAX_SAVED_AI_MESSAGES,
  normalizeSavedMessages,
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

test('saved AI conversations retain valid messages and attachment labels across reloads', () => {
  const messages = normalizeSavedMessages([
    { id: 'u1', role: 'user', content: 'Use this CV', files: ['candidate.pdf'] },
    { id: 'a1', role: 'assistant', content: 'Saved draft', note: 'Reference read' },
    { role: 'system', content: 'must not be persisted' },
  ]);
  assert.deepEqual(messages, [
    { id: 'u1', role: 'user', content: 'Use this CV', files: ['candidate.pdf'] },
    { id: 'a1', role: 'assistant', content: 'Saved draft', note: 'Reference read' },
  ]);
});

test('saved AI conversations are bounded from the oldest side', () => {
  const messages = normalizeSavedMessages(Array.from({ length: 80 }, (_, index) => ({
    id: String(index), role: index % 2 ? 'assistant' : 'user', content: `turn-${index}`,
  })));
  assert.equal(messages.length, MAX_SAVED_AI_MESSAGES);
  assert.equal(messages[0].id, '20');
  assert.equal(messages.at(-1).id, '79');
});

function roleGate(path, method = 'post') {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route exists`);
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

for (const [method, path] of [['get', '/conversations'], ['delete', '/conversations/:id']]) {
  test(`${method.toUpperCase()} ${path} allows employees`, () => {
    let continued = false;
    roleGate(path, method)({ user: { role: 'employee' } }, responseRecorder(), () => { continued = true; });
    assert.equal(continued, true);
  });

  test(`${method.toUpperCase()} ${path} rejects clients`, () => {
    const res = responseRecorder();
    roleGate(path, method)({ user: { role: 'client' } }, res, () => {});
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Forbidden' });
  });
}
