import test from 'node:test';
import assert from 'node:assert/strict';
import router from './clients.routes.js';

const credentialRoutes = [
  ['get', '/:id/credentials'],
  ['put', '/:id/credentials'],
  ['post', '/:id/credentials/:service/reveal'],
];

function roleGate(method, path) {
  const layer = router.stack.find((item) => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method.toUpperCase()} ${path} route exists`);
  return layer.route.stack[0].handle;
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

for (const [method, path] of credentialRoutes) {
  test(`${method.toUpperCase()} ${path} rejects employees before reading credentials`, () => {
    const res = responseRecorder();
    let continued = false;
    roleGate(method, path)({ user: { role: 'employee' } }, res, () => { continued = true; });

    assert.equal(continued, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Forbidden' });
  });

  test(`${method.toUpperCase()} ${path} allows admins through the role gate`, () => {
    const res = responseRecorder();
    let continued = false;
    roleGate(method, path)({ user: { role: 'admin' } }, res, () => { continued = true; });

    assert.equal(continued, true);
    assert.equal(res.statusCode, 200);
  });
}
