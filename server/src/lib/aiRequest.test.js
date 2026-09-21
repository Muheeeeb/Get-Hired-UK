import test from 'node:test';
import assert from 'node:assert/strict';

// env.js reads process.env at import time and dotenv never overrides an
// already-set value, so pin the key/model before ai.js is pulled in.
process.env.ANTHROPIC_API_KEY = 'test-key-not-used';
process.env.ANTHROPIC_MODEL = 'claude-sonnet-5';

const { generateDocument } = await import('./ai.js');

/** Run one turn against a stubbed Anthropic endpoint and return the request body. */
async function captureRequest(options) {
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) };
    return {
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'DRAFT' }],
        model: 'claude-sonnet-5',
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7 },
      }),
    };
  };
  try {
    const result = await generateDocument(options);
    return { ...captured, result };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('a plain chat sends no system prompt — Claude behaves as it does in Pro/Max', async () => {
  const { body } = await captureRequest({ prompt: 'Reformat this CV.' });

  assert.equal('system' in body, false);
  // The typed text is the whole user turn: nothing is prefixed or relabelled,
  // which is what stopped the prompt being echoed into the generated document.
  assert.deepEqual(body.messages, [{
    role: 'user',
    content: [{ type: 'text', text: 'Reformat this CV.', cache_control: { type: 'ephemeral', ttl: '1h' } }],
  }]);
});

test('the master prompt is sent once as a system prompt, cached for an hour', async () => {
  const { body } = await captureRequest({
    prompt: 'Job description: Senior Data Engineer.',
    masterPrompt: 'MASTER PROMPT',
  });

  assert.deepEqual(body.system, [{
    type: 'text',
    text: 'MASTER PROMPT',
    cache_control: { type: 'ephemeral', ttl: '1h' },
  }]);
  // It is not repeated inside the conversation — the job description stands alone.
  assert.equal(JSON.stringify(body.messages).includes('MASTER PROMPT'), false);
});

test('a follow-up job description reuses the cached prefix and adds only itself', async () => {
  const { body } = await captureRequest({
    prompt: 'Second job description.',
    masterPrompt: 'MASTER PROMPT',
    history: [
      { role: 'user', content: 'First job description.' },
      { role: 'assistant', content: 'First CV and cover letter.' },
    ],
  });

  assert.equal(body.system[0].text, 'MASTER PROMPT');
  assert.equal(body.messages.length, 3);
  // Earlier turns stay byte-identical so the hour-long cache still matches …
  assert.deepEqual(body.messages[0], { role: 'user', content: 'First job description.' });
  assert.deepEqual(body.messages[1], { role: 'assistant', content: 'First CV and cover letter.' });
  // … and only the newest turn carries the moving breakpoint.
  assert.deepEqual(body.messages[2].content.at(-1).cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.ok(body.messages.filter((m) => JSON.stringify(m).includes('cache_control')).length === 1);
});

test('at most four cache breakpoints are ever requested', async () => {
  const { body } = await captureRequest({
    prompt: 'JD', masterPrompt: 'MASTER',
    history: Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user', content: `turn ${i}`,
    })),
  });
  assert.ok(JSON.stringify(body).split('cache_control').length - 1 <= 4);
});

test('an attached PDF is sent as a native document block, ahead of the prompt', async () => {
  const pdf = Buffer.from('%PDF-1.7 fake');
  const { body } = await captureRequest({
    prompt: 'Tailor this CV to the role.',
    attachments: [{ name: 'candidate.pdf', pdf, text: 'extracted text' }],
  });

  const [first, second] = body.messages[0].content;
  assert.equal(first.type, 'document');
  assert.equal(first.source.type, 'base64');
  assert.equal(first.source.media_type, 'application/pdf');
  assert.equal(first.source.data, pdf.toString('base64'));
  assert.equal(first.title, 'candidate.pdf');
  assert.equal(second.text, 'Tailor this CV to the role.');
});

test('temperature is never sent (newer Claude models reject it)', async () => {
  const { body } = await captureRequest({ prompt: 'Hello' });
  assert.equal('temperature' in body, false);
  assert.equal(body.model, 'claude-sonnet-5');
});

test('cache usage is reported back so a silent caching regression is visible', async () => {
  const { result } = await captureRequest({ prompt: 'Hello', masterPrompt: 'MASTER' });
  assert.equal(result.usage.cacheReadInputTokens, 7);
  assert.equal(result.draft, 'DRAFT');
});

test('a one-shot call pays no cache-write premium it can never read back', async () => {
  const { draftCoverLetter } = await import('./ai.js');
  const realFetch = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'LETTER' }], usage: {} }) };
  };
  try {
    await draftCoverLetter({ clientName: 'A', jobTitle: 'B', company: 'C', masterCvText: 'CV' });
  } finally {
    globalThis.fetch = realFetch;
  }
  // The system prompt here is fixed, so it may cache; the unique per-job user
  // turn must not, or every call writes an entry nothing ever reads.
  assert.equal(JSON.stringify(body.messages).includes('cache_control'), false);
});

test('an unusable attachment is surfaced on the result rather than dropped', async () => {
  const big = Buffer.alloc(11 * 1024 * 1024, 0x41);
  const { result } = await captureRequest({
    prompt: 'Tailor this.',
    attachments: [{ name: 'scan.pdf', pdf: big, text: '' }],
  });
  assert.deepEqual(result.skippedFiles, ['scan.pdf']);
});
