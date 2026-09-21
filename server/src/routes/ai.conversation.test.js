import test from 'node:test';
import assert from 'node:assert/strict';
import {
  default as router,
  MAX_AI_HISTORY_JSON_CHARS,
  MAX_AI_PROMPT_CHARS,
  MAX_SAVED_AI_MESSAGES,
  AI_KINDS,
  hydrateHistory,
  normaliseKind,
  normalizeSavedMessages,
  parseConversationHistory,
} from './ai.routes.js';


test('AI Studio accepts substantial CV prompts beyond the former 6,000-character ceiling', () => {
  assert.equal(MAX_AI_PROMPT_CHARS, 50_000);
  assert.ok(MAX_AI_HISTORY_JSON_CHARS >= 500_000);
});

test('the specialist prompt reaches Claude untouched — no injected labels to echo back', () => {
  const pasted = 'Reformat this CV for a fintech role.';
  const [turn] = parseConversationHistory(JSON.stringify([{ role: 'user', content: pasted }]));
  assert.equal(turn.content, pasted);
});

test('the two document modes are CV & cover letter, and freeform', () => {
  assert.deepEqual(AI_KINDS, ['cv_cover_letter', 'freeform']);
  assert.equal(normaliseKind('cv'), 'cv_cover_letter');
  assert.equal(normaliseKind('cover_letter'), 'cv_cover_letter');
  assert.equal(normaliseKind('freeform'), 'freeform');
});

test('uploaded references ride with their turn but never reach the browser', () => {
  const saved = normalizeSavedMessages([
    { id: 'u1', role: 'user', content: 'Use this CV', files: ['cv.pdf'], refs: [{ name: 'cv.pdf', text: 'CV BODY', key: 'ai-refs/u/1-cv.pdf' }] },
  ]);
  assert.deepEqual(saved[0].refs, [{ name: 'cv.pdf', text: 'CV BODY', key: 'ai-refs/u/1-cv.pdf' }]);

  const [turn] = parseConversationHistory(JSON.stringify(saved));
  assert.equal(turn.content, 'Use this CV');
  assert.deepEqual(turn.refs, [{ name: 'cv.pdf', text: 'CV BODY', key: 'ai-refs/u/1-cv.pdf' }]);
});

test('a non-PDF reference is replayed as its extracted text, ahead of what was typed', async () => {
  const [turn] = await hydrateHistory(parseConversationHistory(JSON.stringify([
    { role: 'user', content: 'Use this CV', refs: [{ name: 'cv.docx', text: 'CV BODY' }] },
  ])), 'user-1');

  assert.equal(turn.content[0].type, 'text');
  assert.match(turn.content[0].text, /<document name="cv.docx">/);
  assert.match(turn.content[0].text, /CV BODY/);
  assert.equal(turn.content[1].text, 'Use this CV');
});

test('every replayed turn uses block form, so the cached prefix stays byte-stable', async () => {
  // A fresh turn is sent as content blocks. Replaying an earlier turn as a bare
  // string would change the bytes of the prefix and cost the cache hit, so the
  // two representations have to match.
  const [turn] = await hydrateHistory(parseConversationHistory(JSON.stringify([
    { role: 'user', content: 'Just a job description' },
  ])), 'user-1');
  assert.deepEqual(turn.content, [{ type: 'text', text: 'Just a job description' }]);
});

test('a reference key outside the user\'s own AI Studio folder is never opened', async () => {
  // The key can arrive from the browser, so ownership is checked before any
  // read: otherwise a specialist could name another client's master CV and have
  // the server hand it to Claude, bypassing the file routes' role checks.
  const foreign = await hydrateHistory([
    { role: 'user', content: 'go', refs: [{ name: 'victim.pdf', text: '', key: 'masters/someone-else/abc-victim.pdf' }] },
  ], 'user-1');
  assert.deepEqual(foreign[0].content, [{ type: 'text', text: 'go' }]);

  const otherUser = await hydrateHistory([
    { role: 'user', content: 'go', refs: [{ name: 'x.pdf', text: '', key: 'ai-refs/another-user/abc-x.pdf' }] },
  ], 'user-1');
  assert.deepEqual(otherUser[0].content, [{ type: 'text', text: 'go' }]);

  // A prefix that merely starts with the user id must not pass either.
  const confusable = await hydrateHistory([
    { role: 'user', content: 'go', refs: [{ name: 'x.pdf', text: '', key: 'ai-refs/user-1-evil/abc-x.pdf' }] },
  ], 'user-1');
  assert.deepEqual(confusable[0].content, [{ type: 'text', text: 'go' }]);
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
