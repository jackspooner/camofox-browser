import test from 'node:test';
import assert from 'node:assert/strict';
import { transferHandshake } from '../../lib/platform/viewer-transfer-handshake.js';
const version = Buffer.from('RFB 003.008\n');
function harness() {
  const events = [];
  return { events, ...transferHandshake({ toClient: data => events.push(['client', data]), toBackend: data => events.push(['backend', data]), ready: () => events.push(['ready']) }) };
}
function initialize(h) {
  h.server(version); h.client(version); h.server(Buffer.from([1, 1])); h.client(Buffer.from([1])); h.server(Buffer.alloc(4)); h.client(Buffer.from([1]));
}
test('fragmented handshake commits before forwarding ServerInit and then permits input', () => {
  const h = harness();
  h.server(version.subarray(0, 5)); assert.equal(h.events.length, 0);
  h.server(version.subarray(5));
  h.client(version.subarray(0, 8)); h.client(version.subarray(8));
  h.server(Buffer.from([1])); h.server(Buffer.from([1])); h.client(Buffer.from([1]));
  h.server(Buffer.alloc(2)); h.server(Buffer.alloc(2)); h.client(Buffer.from([1]));
  const init = Buffer.alloc(28); init.writeUInt16BE(1280); init.writeUInt16BE(720, 2); init.writeUInt32BE(4, 20); init.write('test', 24);
  h.server(init.subarray(0, 25)); assert(!h.events.some(e => e[0] === 'ready'));
  h.server(init.subarray(25)); assert.equal(h.events.at(-2)[0], 'ready'); assert.deepEqual(h.events.at(-1), ['client', init]);
  const input = Buffer.from([4, 1, 0, 0, 0, 0, 0, 65]); h.client(input); assert.deepEqual(h.events.at(-1), ['backend', input]);
});
test('early input, unsupported protocols and oversized server initialization fail closed', () => {
  assert.throws(() => harness().client(version));
  assert.throws(() => harness().server(Buffer.from('RFB 003.003\n')));
  const h = harness(); initialize(h);
  assert.throws(() => h.client(Buffer.from([4, 1])));
  const large = harness(); initialize(large);
  const init = Buffer.alloc(24); init.writeUInt32BE(65537, 20);
  assert.throws(() => large.server(init));
  const pipelined = harness(); pipelined.server(version);
  assert.throws(() => pipelined.client(Buffer.concat([version, Buffer.from([1, 1, 4, 1])])));
});
