import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMML, chordNotes, midiToFreq } from '../src/audio/synth.js';

test('MML length counts beats', () => {
  assert.equal(parseMML('o4 l4 cdef').length, 4);
  assert.equal(parseMML('o4 l8 cdefgabc').length, 4);
});

test('chord names are understood', () => {
  for (const name of ['C', 'Am', 'Dmaj7', 'Bm7', 'G7']) assert.ok(chordNotes(name).length >= 3, name);
});

test('A4 is 440 Hz', () => {
  assert.equal(midiToFreq(69), 440);
});
