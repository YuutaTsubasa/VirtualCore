import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRoomCode, roomCodeOf, shareLink, signalServer, ROOM_CODE_CHARS } from '../src/net/site.js';

test('room codes are 5 letters/digits with at least one letter', () => {
  assert.ok(isRoomCode('K7QX2'));
  assert.ok(isRoomCode('k7qx2'));
  assert.ok(!isRoomCode('77880'), '只有數字視為通訊埠');
  assert.ok(!isRoomCode('K7QX'));
  assert.ok(!isRoomCode('192.168.1.5:7788'));
  assert.ok(!/[01OIL]/.test(ROOM_CODE_CHARS), '不用容易看錯的字');
});

test('room code from a typed code or a share link', () => {
  assert.equal(roomCodeOf(' k7qx2 '), 'K7QX2');
  assert.equal(roomCodeOf('https://example.com/volleyball/#join/K7QX2'), 'K7QX2');
  assert.equal(roomCodeOf('192.168.1.5:7788'), null);
  assert.equal(roomCodeOf('7788'), null);
});

test('share link', () => {
  assert.equal(shareLink('K7QX2', 'https://example.com/vb/'), 'https://example.com/vb/#join/K7QX2');
  assert.equal(shareLink('K7QX2', 'https://example.com/vb/#join/AAAAA'), 'https://example.com/vb/#join/K7QX2');
  assert.equal(shareLink('K7QX2', ''), '');
});

test('signal server setting', () => {
  assert.equal(signalServer('', 'https://a.example/'), 'https://a.example');
  assert.equal(signalServer('http://localhost:8787', 'https://a.example'), 'http://localhost:8787');
  assert.equal(signalServer('off', 'https://a.example'), '');
});
