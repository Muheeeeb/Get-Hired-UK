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

/** Run one turn against a scripted sequence of Anthropic responses. */
async function captureTurn(options, responses) {
  const realFetch = globalThis.fetch;
  const bodies = [];
  let call = 0;
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    const payload = responses[Math.min(call++, responses.length - 1)];
    return { ok: true, json: async () => payload };
  };
  try {
    return { bodies, result: await generateDocument(options) };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('the studio declares the web tools — this is what the Pro/Max apps have and the API does not', async () => {
  const { body } = await captureRequest({ prompt: 'Is there a new model out today?' });
  assert.deepEqual(body.tools.map((t) => t.name), ['web_search', 'web_fetch']);
});

test('thinking is on for the studio, as it is in the browser', async () => {
  const { body } = await captureRequest({ prompt: 'Hello' });
  assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized' });
  assert.deepEqual(body.output_config, { effort: 'high' });
});

test('the admin-chosen effort reaches the API', async () => {
  const { body } = await captureRequest({ prompt: 'Hello', effort: 'xhigh' });
  assert.deepEqual(body.output_config, { effort: 'xhigh' });
});

test('a paused turn is resumed rather than returned half-written', async () => {
  // A server tool can hand back `pause_turn` mid-sentence. Returning that as the
  // reply would show the specialist a CV that stops in the middle of a word.
  const { bodies, result } = await captureTurn({ prompt: 'Find the latest NHS band 6 pay.' }, [
    {
      stop_reason: 'pause_turn',
      content: [
        { type: 'text', text: 'Let me check.' },
        { type: 'web_search_tool_result', content: [{ url: 'https://nhs.uk/pay', title: 'NHS pay' }] },
      ],
      usage: { input_tokens: 10, output_tokens: 4 },
    },
    {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Band 6 starts at £37,338.' }],
      usage: { input_tokens: 12, output_tokens: 6 },
    },
  ]);

  assert.equal(bodies.length, 2);
  // The resume replays the partial assistant turn, so the cached prefix holds.
  assert.equal(bodies[1].messages.at(-1).role, 'assistant');
  assert.equal(result.draft, 'Let me check.\nBand 6 starts at £37,338.');
  // Tokens from every round are billed, so every round is reported.
  assert.equal(result.usage.inputTokens, 22);
  assert.equal(result.usage.outputTokens, 10);
});

test('a turn that never stops pausing is bounded instead of looping forever', async () => {
  const { bodies } = await captureTurn({ prompt: 'Search forever.' }, [{
    stop_reason: 'pause_turn',
    content: [{ type: 'text', text: 'still going' }],
    usage: {},
  }]);
  assert.equal(bodies.length, 4);
});

test('the pages Claude opened come back with the reply', async () => {
  const { result } = await captureTurn({ prompt: 'What does this employer do?' }, [{
    stop_reason: 'end_turn',
    content: [
      {
        type: 'web_search_tool_result',
        content: [
          { url: 'https://example.com/a', title: 'A' },
          { url: 'https://example.com/a', title: 'A again' },
        ],
      },
      { type: 'web_fetch_tool_result', content: { url: 'https://example.com/b', content: { title: 'B' } } },
      { type: 'text', text: 'They make widgets.' },
    ],
    usage: {},
  }]);

  // De-duplicated by URL, so one page cited three times is listed once.
  assert.deepEqual(result.sources, [
    { url: 'https://example.com/a', title: 'A' },
    { url: 'https://example.com/b', title: 'B' },
  ]);
});

test('a failed web search is reported, not silently answered from memory', async () => {
  // These arrive as a normal 200 with an error object where the results list
  // goes, so nothing upstream would otherwise notice.
  const { result } = await captureTurn({ prompt: 'Latest news?' }, [{
    stop_reason: 'end_turn',
    content: [
      { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
      { type: 'text', text: 'From what I know…' },
    ],
    usage: {},
  }]);
  assert.equal(result.searchErrorCode, 'max_uses_exceeded');
});

test('the reasoning summary is captured for display', async () => {
  const { result } = await captureTurn({ prompt: 'Tailor this CV.' }, [{
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: 'The role wants audit experience.' },
      { type: 'text', text: 'Here is the CV.' },
    ],
    usage: {},
  }]);
  assert.equal(result.thinking, 'The role wants audit experience.');
  // It is never mixed into the document the specialist downloads.
  assert.equal(result.draft, 'Here is the CV.');
});

test('a refusal is a clear message, not "empty response"', async () => {
  await assert.rejects(
    () => captureTurn({ prompt: 'Something disallowed.' }, [{
      stop_reason: 'refusal', content: [], usage: {},
    }]),
    (err) => err.status === 400 && /declined/i.test(err.publicMessage)
  );
});

test('a reply cut off at the token ceiling is flagged', async () => {
  const { result } = await captureTurn({ prompt: 'Write a long CV.' }, [{
    stop_reason: 'max_tokens',
    content: [{ type: 'text', text: 'Half a CV' }],
    usage: {},
  }]);
  assert.equal(result.truncated, true);
});

test('the bulk cover-letter action gets no web tools', async () => {
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
  // It runs per application off a CV the server already holds: a web search per
  // letter would add cost and latency without adding anything to write with.
  assert.equal('tools' in body, false);
  // Thinking is left alone. On Sonnet 5 — the configured default — omitting the
  // field already ran adaptive thinking, so this is the behaviour it had before.
  assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized' });
});
