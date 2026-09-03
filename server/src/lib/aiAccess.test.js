import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClaudeModel } from './aiAccess.js';

test('admins can select a requested Claude model', () => {
  assert.equal(resolveClaudeModel({
    role: 'admin', requestedModel: 'claude-opus-example', defaultModel: 'claude-sonnet-example',
  }), 'claude-opus-example');
});

test('employees use the model assigned by their admin', () => {
  assert.equal(resolveClaudeModel({
    role: 'employee', assignedModel: 'claude-haiku-example',
    requestedModel: 'claude-haiku-example', defaultModel: 'claude-sonnet-example',
  }), 'claude-haiku-example');
});

test('employees cannot request a different model', () => {
  assert.throws(() => resolveClaudeModel({
    role: 'employee', assignedModel: 'claude-haiku-example',
    requestedModel: 'claude-opus-example', defaultModel: 'claude-sonnet-example',
  }), (err) => err.status === 403);
});
