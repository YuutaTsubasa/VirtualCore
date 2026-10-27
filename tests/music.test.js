import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// 假的 AudioContext：每個節點的方法都回傳自己，只記下音源 start 的時間
const starts = [];
function node() {
  const n = new Proxy(
    {},
    {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'start') return (t) => starts.push(t);
        if (['gain', 'frequency', 'detune', 'Q', 'threshold', 'ratio', 'pan', 'playbackRate'].includes(key)) {
          return (target[key] = node());
        }
        if (key === 'getChannelData') return () => new Float32Array(8);
        if (key === 'then') return undefined;
        return () => n;
      },
      set(target, key, v) {
        target[key] = v;
        return true;
      },
    },
  );
  return n;
}
class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 8;
    this.destination = node();
    return new Proxy(this, {
      get: (t, k) => (k in t ? t[k] : () => node()),
    });
  }
}
globalThis.window = { AudioContext: FakeAudioContext };

const { compile, Player } = await import('../src/audio/music.js');
const { audioContext } = await import('../src/audio/synth.js');

// 一小節四拍、四個音
const SONG = { bpm: 120, tracks: [{ kind: 'ssg', mml: 'o4 l4 cdef' }] };

test('compile turns a song into time-ordered events', () => {
  const { events, length } = compile(SONG);
  assert.equal(length, 4);
  assert.equal(events.length, 4);
  assert.deepEqual(events.map((e) => e.beat), [0, 1, 2, 3]);
});

function run(opts, seconds) {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const ctx = audioContext();
  ctx.currentTime = 10;
  starts.length = 0;
  const player = new Player();
  let ended = 0;
  const first = player.play(SONG, { ...opts, onEnd: () => ended++ });
  for (let ms = 0; ms < seconds * 1000; ms += 25) {
    ctx.currentTime += 0.025;
    mock.timers.tick(25);
  }
  player.stop(0);
  mock.timers.reset();
  return { first, notes: starts.length, ended };
}

test('play starts at the given AudioContext time and returns it', () => {
  const { first, notes, ended } = run({ at: 10.5 }, 3);
  assert.equal(first, 10.5);
  assert.equal(notes, 4);
  assert.equal(ended, 1);
});

test('repeat plays a non-looping song several times, then ends once', () => {
  const { notes, ended } = run({ at: 10.5, repeat: 3 }, 7);
  assert.equal(notes, 12);
  assert.equal(ended, 1);
});

test('without at, play starts a little after now', () => {
  const { first } = run({}, 0);
  assert.ok(first > 10 && first < 10.2, String(first));
});
