// PC-98 風格音源（用 Web Audio 即時合成，不需要任何音檔）。Virtual 系列五款共用這一份（最早來自 TaiwanMahjong）。
//
// 模仿 YM2608（OPNA）的三個部分：
//   FM  —— 載波＋調變器串接的 FM 合成（lead、brass、e-piano、slap bass…）
//   SSG —— 方波（PSG）
//   Rhythm —— 大鼓、小鼓、Hi-hat 用雜訊與掃頻合成
// 音樂用 MML 寫（當年 PC-98 作曲最常見的格式），由 Sequencer 排程播放。

let ctx = null;
let master, bgmBus, sfxBus, noiseBuf;

export function audioContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  // 輕微低通＋壓縮：讓聲音像從 PC-98 的喇叭出來，也避免爆音
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 11000;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(lp).connect(comp).connect(ctx.destination);
  bgmBus = ctx.createGain();
  sfxBus = ctx.createGain();
  bgmBus.connect(master);
  sfxBus.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export const buses = {
  get bgm() { return bgmBus; },
  get sfx() { return sfxBus; },
};

export function setBusVolume(which, v) {
  if (!audioContext()) return;
  const bus = which === 'bgm' ? bgmBus : sfxBus;
  bus.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
}

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** ADSR：attack 到 peak，decay 到 peak*sustain，dur 之後 release 到 0 */
function adsr(param, t, peak, { a = 0.005, d = 0.2, s = 0.6, r = 0.1 }, dur) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(peak * s, t + a, Math.max(d, 0.001) / 3);
  param.setTargetAtTime(0, t + Math.max(dur, a), Math.max(r, 0.001) / 3);
}

// ───────── FM 音色表 ─────────
// mods：依序串接，mods[0] 調變載波、mods[1] 調變 mods[0]…（OPN 的 algorithm 0 簡化版）
// index：調變深度（相對於頻率），env 會讓音色隨時間變化，這正是 FM 的味道
export const PATCHES = {
  lead: {
    level: 0.2,
    env: { a: 0.01, d: 0.4, s: 0.7, r: 0.12 },
    mods: [
      { ratio: 1, index: 1.4, env: { a: 0.01, d: 0.3, s: 0.55, r: 0.1 } },
      { ratio: 2, index: 0.8, env: { a: 0.01, d: 0.2, s: 0.3, r: 0.1 } },
    ],
  },
  brass: {
    level: 0.18,
    env: { a: 0.04, d: 0.3, s: 0.8, r: 0.12 },
    mods: [{ ratio: 1, index: 2.6, env: { a: 0.06, d: 0.25, s: 0.7, r: 0.12 } }],
  },
  epiano: {
    level: 0.13,
    env: { a: 0.003, d: 0.9, s: 0.25, r: 0.25 },
    mods: [{ ratio: 1, index: 1.1, env: { a: 0.003, d: 0.5, s: 0.2, r: 0.2 } }],
    tine: { ratio: 14, index: 0.5, env: { a: 0.001, d: 0.06, s: 0, r: 0.05 } },
  },
  bass: {
    level: 0.32,
    env: { a: 0.004, d: 0.35, s: 0.55, r: 0.06 },
    mods: [
      { ratio: 1, index: 3.2, env: { a: 0.003, d: 0.12, s: 0.25, r: 0.06 } },
      { ratio: 1, index: 0.9, env: { a: 0.003, d: 0.08, s: 0.1, r: 0.05 } },
    ],
  },
  bell: {
    level: 0.12,
    env: { a: 0.002, d: 1.4, s: 0, r: 0.4 },
    mods: [{ ratio: 3.5, index: 2.2, env: { a: 0.002, d: 0.8, s: 0, r: 0.3 } }],
  },
  strings: {
    level: 0.08,
    env: { a: 0.18, d: 0.4, s: 0.85, r: 0.35 },
    mods: [{ ratio: 1, index: 0.9, env: { a: 0.2, d: 0.5, s: 0.8, r: 0.3 } }],
    detune: 4,
  },
  // 角色主題曲用的音色
  flute: {
    level: 0.17,
    env: { a: 0.04, d: 0.3, s: 0.8, r: 0.15 },
    mods: [{ ratio: 1, index: 0.35, env: { a: 0.05, d: 0.3, s: 0.6, r: 0.1 } }],
  },
  sax: {
    level: 0.16,
    env: { a: 0.03, d: 0.3, s: 0.75, r: 0.1 },
    mods: [
      { ratio: 1, index: 1.8, env: { a: 0.04, d: 0.2, s: 0.6, r: 0.1 } },
      { ratio: 3, index: 0.3, env: { a: 0.01, d: 0.1, s: 0.2, r: 0.05 } },
    ],
  },
  guitar: {
    level: 0.14,
    env: { a: 0.005, d: 0.6, s: 0.5, r: 0.1 },
    mods: [
      { ratio: 1, index: 3.5, env: { a: 0.005, d: 0.3, s: 0.5, r: 0.1 } },
      { ratio: 2, index: 1.2, env: { a: 0.005, d: 0.2, s: 0.3, r: 0.1 } },
    ],
  },
  organ: {
    level: 0.09,
    env: { a: 0.01, d: 0.2, s: 1, r: 0.08 },
    mods: [{ ratio: 2, index: 0.6, env: { a: 0.01, d: 0.2, s: 1, r: 0.08 } }],
  },
};

/** 播一個 FM 音（時間 t 秒、長度 dur 秒） */
export function fmNote(dest, patchName, midi, t, dur, vel = 1, pan = 0) {
  const p = PATCHES[patchName] ?? PATCHES.lead;
  const f = midiToFreq(midi);
  const out = ctx.createGain();
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  out.connect(panner).connect(dest);
  adsr(out.gain, t, p.level * vel, p.env, dur);

  const end = t + dur + (p.env.r ?? 0.1) * 2.5 + 0.05;
  const oscs = [];
  const voices = p.detune ? [-p.detune, p.detune] : [0];
  for (const det of voices) {
    const car = ctx.createOscillator();
    car.frequency.value = f;
    car.detune.value = det;
    car.connect(out);
    oscs.push(car);
    let target = car.frequency;
    for (const m of p.mods) {
      const mo = ctx.createOscillator();
      mo.frequency.value = f * m.ratio;
      const mg = ctx.createGain();
      adsr(mg.gain, t, m.index * f * m.ratio, m.env, dur);
      mo.connect(mg).connect(target);
      target = mo.frequency;
      oscs.push(mo);
    }
    if (p.tine) {
      const mo = ctx.createOscillator();
      mo.frequency.value = f * p.tine.ratio;
      const mg = ctx.createGain();
      adsr(mg.gain, t, p.tine.index * f * p.tine.ratio, p.tine.env, dur);
      mo.connect(mg).connect(car.frequency);
      oscs.push(mo);
    }
  }
  for (const o of oscs) {
    o.start(t);
    o.stop(end);
  }
}

/** SSG 方波 */
export function ssgNote(dest, midi, t, dur, vel = 1, pan = 0, env = { a: 0.002, d: 0.08, s: 0.6, r: 0.04 }) {
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.value = midiToFreq(midi);
  const g = ctx.createGain();
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  adsr(g.gain, t, 0.045 * vel, env, dur);
  o.connect(g).connect(panner).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.3);
}

function noise(dest, t, dur, { type = 'highpass', freq = 7000, q = 0.7, vol = 0.2, decay = 0.05 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = freq;
  filt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
  src.connect(filt).connect(g).connect(dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + Math.max(dur, decay) + 0.02);
}

/** OPNA 節奏音源的簡化版 */
export function drum(dest, kind, t, vel = 1) {
  if (kind === 'k') {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.75 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.3);
  } else if (kind === 's') {
    noise(dest, t, 0.16, { type: 'bandpass', freq: 1900, q: 0.8, vol: 0.42 * vel, decay: 0.16 });
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const g = ctx.createGain();
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.06);
    g.gain.setValueAtTime(0.25 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.1);
  } else if (kind === 'h') {
    noise(dest, t, 0.05, { freq: 8000, vol: 0.09 * vel, decay: 0.04 });
  } else if (kind === 'o') {
    noise(dest, t, 0.2, { freq: 7000, vol: 0.08 * vel, decay: 0.22 });
  } else if (kind === 'c') {
    noise(dest, t, 0.8, { freq: 5000, vol: 0.12 * vel, decay: 0.9 });
  }
}

/** 給音效用的雜訊（例如牌碰桌面的聲音） */
export function noiseHit(dest, t, opts) {
  noise(dest, t, opts.decay ?? 0.05, opts);
}

// ───────── MML ─────────
// 支援：c d e f g a b（+ # - 升降）、r 休止、數字長度與附點、& 連結、
//       o 八度、< > 升降八度、l 預設長度、v 音量(0-15)、[ … ]n 重複、| 小節線（忽略）
// 長度單位是「拍」（四分音符 = 1 拍）。
const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export function parseMML(src) {
  let i = 0;
  const s = src.toLowerCase();
  let octave = 4;
  let defLen = 0.5;
  let vel = 1;
  let beat = 0;
  const notes = [];
  const loopStack = [];

  const readNum = () => {
    let n = '';
    while (i < s.length && /[0-9]/.test(s[i])) n += s[i++];
    return n === '' ? null : Number(n);
  };
  const readLen = () => {
    const n = readNum();
    let len = n ? 4 / n : defLen;
    let add = len / 2;
    while (s[i] === '.') {
      len += add;
      add /= 2;
      i++;
    }
    return len;
  };

  while (i < s.length) {
    const ch = s[i++];
    if (ch in NOTE) {
      let semi = NOTE[ch];
      while (s[i] === '+' || s[i] === '#' || s[i] === '-') semi += s[i++] === '-' ? -1 : 1;
      let len = readLen();
      while (s[i] === '&') {
        i++;
        // & 後面可以接同一個音或只寫長度
        if (s[i] in NOTE) {
          i++;
          while (s[i] === '+' || s[i] === '#' || s[i] === '-') i++;
        }
        len += readLen();
      }
      notes.push({ beat, dur: len, midi: 12 * (octave + 1) + semi, vel });
      beat += len;
    } else if (ch === 'r') {
      beat += readLen();
    } else if (ch === 'o') {
      octave = readNum() ?? octave;
    } else if (ch === '<') {
      octave--;
    } else if (ch === '>') {
      octave++;
    } else if (ch === 'l') {
      const n = readNum();
      if (n) defLen = 4 / n;
    } else if (ch === 'v') {
      vel = (readNum() ?? 15) / 15;
    } else if (ch === '[') {
      loopStack.push({ start: notes.length, beat, octave });
    } else if (ch === ']') {
      const times = readNum() ?? 2;
      const lp = loopStack.pop();
      if (!lp) continue;
      const body = notes.slice(lp.start);
      const span = beat - lp.beat;
      for (let k = 1; k < times; k++) {
        for (const n of body) notes.push({ ...n, beat: n.beat + span * k });
      }
      beat += span * (times - 1);
    }
    // 空白、| 之類的直接略過
  }
  return { notes, length: beat };
}

// ───────── 和弦 ─────────
const CHORD_TYPES = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dim: [0, 3, 6],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
};

/** 'F#m7' → MIDI 音（擺在 G3~F#4 一帶，聽起來比較集中） */
export function chordNotes(name) {
  const m = /^([A-G])([#b]?)(.*)$/.exec(name);
  if (!m) return [];
  let root = NOTE[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  root = ((root % 12) + 12) % 12;
  const base = 55 + ((root - 7 + 12) % 12);
  return (CHORD_TYPES[m[3]] ?? CHORD_TYPES['']).map((iv) => base + iv);
}
