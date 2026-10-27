import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTranslator, p2pSupported } from '../src/net/p2p.js';

test('p2p loads without a browser', () => {
  assert.equal(typeof setTranslator, 'function');
  assert.equal(p2pSupported, typeof RTCPeerConnection !== 'undefined' && typeof WebSocket !== 'undefined');
});
