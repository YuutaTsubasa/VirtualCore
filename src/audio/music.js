// 曲子的播放器：把各遊戲自己的曲目（songs.js）展開成事件，用 lookahead 排程播放。
// Virtual 系列五款共用這一份（最早來自 TaiwanMahjong）；曲目不在這裡，由遊戲自己 import 自己的 songs.js。
//
// 每首曲子由幾個音軌組成：
//   { kind: 'fm',     patch, mml, pan, vel }      FM 音色彈 MML
//   { kind: 'ssg',    mml, pan, vel }             方波彈 MML
//   { kind: 'chords', patch, prog, rhythm, vel }  依和弦進行自動伴奏
//       prog：'Dmaj7 Bm7 G7:2 C7:2'（預設一個和弦一小節，:n 表示 n 拍）
//       rhythm：一小節 8 格（八分音符）；x = 短促、W = 延長整個和弦
//   { kind: 'drums',  k, s, h, o, hits }          一小節 16 格，x 表示打；hits 是 [種類, 拍] 的額外打擊
//   { kind: 'bass',   patch, prog, pattern }       依和弦自動彈貝斯：pattern 一小節 8 格（八分音符）
//       r = 根音、5 = 五度、o = 高八度根音、3 = 三度、. = 休息
//   { kind: 'arp',    prog, pattern, oct, patch? } 依和弦自動琶音（十六分音符），pattern 是和弦音的編號，
//       例如 '0121'；沒給 patch 就用 SSG 方波
// 長度（拍數）以最長的旋律音軌為準。曲子可以設 gain（0～1）調整整首的音量。

import { audioContext, buses, fmNote, ssgNote, drum, parseMML, chordNotes } from './synth.js';

/** 把曲子展開成依時間排序的事件 */
function compile(song) {
  const events = [];
  let length = 0;
  for (const tr of song.tracks) {
    if (tr.mml) {
      const { notes, length: len } = parseMML(tr.mml);
      length = Math.max(length, len);
      for (const n of notes) events.push({ beat: n.beat, dur: n.dur, midi: n.midi, vel: n.vel * (tr.vel ?? 1), tr });
    }
    if (tr.kind === 'bass' || tr.kind === 'arp') {
      let beat = 0;
      for (const tok of tr.prog.split(/\s+/).filter(Boolean)) {
        const [name, b] = tok.split(':');
        const beats = b ? Number(b) : 4;
        const notes = chordNotes(name);
        if (tr.kind === 'bass') {
          // 根音放在 C2～B2 一帶
          let root = notes[0] - 24;
          if (root < 36) root += 12;
          const pick = { r: root, 5: root + 7, o: root + 12, 3: root + (notes[1] - notes[0]) };
          for (let step = 0; step < beats * 2; step++) {
            const ch = tr.pattern[(Math.round(beat * 2) + step) % tr.pattern.length];
            if (ch in pick) events.push({ beat: beat + step / 2, dur: 0.45, midi: pick[ch], vel: tr.vel ?? 1, tr });
          }
        } else {
          for (let step = 0; step < beats * 4; step++) {
            const k = Number(tr.pattern[step % tr.pattern.length]);
            const midi = notes[k % notes.length] + 12 * (Math.floor(k / notes.length) + (tr.oct ?? 1));
            events.push({ beat: beat + step / 4, dur: 0.22, midi, vel: tr.vel ?? 1, tr });
          }
        }
        beat += beats;
      }
      length = Math.max(length, beat);
    }
    if (tr.kind === 'chords') {
      let beat = 0;
      for (const tok of tr.prog.split(/\s+/).filter(Boolean)) {
        const [name, b] = tok.split(':');
        const beats = b ? Number(b) : 4;
        const notes = chordNotes(name);
        for (let step = 0; step < beats * 2; step++) {
          const ch = tr.rhythm[(Math.round(beat * 2) + step) % tr.rhythm.length];
          if (ch === 'x' || (ch === 'W' && step === 0)) {
            const dur = ch === 'W' ? beats - 0.05 : 0.42;
            for (const midi of notes) events.push({ beat: beat + step / 2, dur, midi, vel: tr.vel ?? 1, tr });
          }
        }
        beat += beats;
      }
      length = Math.max(length, beat);
    }
  }
  // 鼓要等知道曲長後再鋪
  for (const tr of song.tracks) {
    if (tr.kind !== 'drums') continue;
    for (const kind of ['k', 's', 'h', 'o']) {
      const pat = tr[kind];
      if (!pat) continue;
      for (let step = 0; step * 0.25 < length; step++) {
        if (pat[step % pat.length] === 'x') events.push({ beat: step * 0.25, drum: kind, tr });
      }
    }
    for (const [kind, beat] of tr.hits ?? []) {
      events.push({ beat, drum: kind, tr });
      length = Math.max(length, beat + 1);
    }
  }
  events.sort((a, b) => a.beat - b.beat);
  return { events, length };
}

const compiled = new Map();
function compiledSong(song) {
  if (!compiled.has(song)) compiled.set(song, compile(song));
  return compiled.get(song);
}

/** 預先排程的播放器（lookahead 排程，避免 setTimeout 抖動造成節奏不穩） */
export class Player {
  constructor() {
    this.timer = null;
    this.out = null;
  }

  play(song, { onEnd } = {}) {
    const ctx = audioContext();
    if (!ctx) return;
    this.stop(0);
    const { events, length } = compiledSong(song);
    const spb = 60 / song.bpm;
    const out = ctx.createGain();
    out.gain.value = song.gain ?? 1;
    out.connect(buses.bgm);
    this.out = out;
    let start = ctx.currentTime + 0.08;
    let idx = 0;
    let ended = false;
    const tick = () => {
      const ahead = ctx.currentTime + 0.18;
      for (;;) {
        if (idx >= events.length) {
          if (song.loop) {
            start += length * spb;
            idx = 0;
            continue;
          }
          if (!ended && ctx.currentTime > start + length * spb) {
            ended = true;
            this.stop(0);
            onEnd?.();
          }
          return;
        }
        const ev = events[idx];
        const t = start + ev.beat * spb;
        if (t > ahead) return;
        idx++;
        if (t < ctx.currentTime - 0.05) continue; // 分頁在背景時落後太多就跳過
        const pan = ev.tr.pan ?? 0;
        if (ev.drum) drum(out, ev.drum, t);
        else if (ev.tr.kind === 'ssg' || (ev.tr.kind === 'arp' && !ev.tr.patch)) ssgNote(out, ev.midi, t, ev.dur * spb * 0.9, ev.vel, pan);
        else if (ev.tr.kind === 'bass') fmNote(out, ev.tr.patch ?? 'bass', ev.midi, t, ev.dur * spb * 0.92, ev.vel, pan);
        else fmNote(out, ev.tr.patch, ev.midi, t, ev.dur * spb * 0.92, ev.vel, pan);
      }
    };
    tick();
    this.timer = setInterval(tick, 25);
  }

  stop(fade = 0.4) {
    clearInterval(this.timer);
    this.timer = null;
    const out = this.out;
    this.out = null;
    if (!out) return;
    const ctx = audioContext();
    out.gain.setTargetAtTime(0, ctx.currentTime, Math.max(fade, 0.01) / 3);
    setTimeout(() => out.disconnect(), fade * 1000 + 600);
  }

  get playing() {
    return this.timer != null;
  }
}
