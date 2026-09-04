import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeRequest } from './ai.js';

test('Claude request uses fields supported by Sonnet 5', () => {
  const request = buildClaudeRequest({
    model: 'claude-sonnet-5',
    system: 'Be helpful.',
    messages: [{ role: 'user', content: 'Hello' }],
    maxTokens: 100,
  });

  assert.deepEqual(request, {
    model: 'claude-sonnet-5',
    system: 'Be helpful.',
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 100,
  });
  assert.equal('temperature' in request, false);
});
