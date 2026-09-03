/** Resolve a Claude model while enforcing an employee's admin-assigned model. */
export function resolveClaudeModel({ role, assignedModel, requestedModel, defaultModel }) {
  if (role === 'admin') return requestedModel || defaultModel;
  const allowed = assignedModel || defaultModel;
  if (requestedModel && requestedModel !== allowed) {
    const err = new Error('This Claude model is not enabled for your account');
    err.status = 403;
    throw err;
  }
  return allowed;
}
