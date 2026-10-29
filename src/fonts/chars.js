// 遊戲裡用到哪些字：把原始碼裡出現過的字全部收集起來，字型只留這些字（scripts/fonts/build.mjs）。
// 遊戲的測試也用它檢查：新加的字有沒有忘了重產字型（missingChars）。Node 專用。
//
// 設定檔是遊戲根目錄的 fonts.config.json：
//   { "out": "src/fonts", "text": ["src", "crates", "index.html"], "families": ["VSans", "VKai", ...] }
//   families 的一項也可以是 { "family": "VSansJP", "text": ["src/lib/i18n/ja"] }：只收那些檔案裡的字（日文字型只給日文介面用）

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

// 看這些副檔名的檔案
const EXTS = new Set(['.js', '.mjs', '.ts', '.svelte', '.css', '.html', '.json', '.rs']);
// 不看的資料夾（建置產物、套件、wasm 輸出）
const SKIP = new Set(['node_modules', 'target', 'dist', 'pkg', 'generated', '.git', 'gen']);

// 一定要有的字：英數與標點（ASCII）、全形標點、中日標點、假名（玩家名字、聊天常用，很便宜）
const RANGES = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x2010, 0x2027],
  [0x2030, 0x203b],
  [0x2190, 0x2193],
  [0x3000, 0x303f],
  [0x3040, 0x30ff],
  [0xff01, 0xff5e],
];

export function baseChars() {
  const set = new Set();
  for (const [a, b] of RANGES) for (let c = a; c <= b; c++) set.add(String.fromCodePoint(c));
  return set;
}

export function readConfig(root) {
  return JSON.parse(readFileSync(join(root, 'fonts.config.json'), 'utf8'));
}

function walk(path, skipDir, out) {
  if (!existsSync(path)) return;
  const st = statSync(path);
  if (st.isDirectory()) {
    if (SKIP.has(path.split(/[\\/]/).pop()) || resolve(path) === skipDir) return;
    for (const name of readdirSync(path)) walk(join(path, name), skipDir, out);
  } else if (EXTS.has(extname(path))) out.push(path);
}

/** 原始碼裡用到的字（含 baseChars），回傳排好序的陣列 */
export function collectChars(root, config = readConfig(root)) {
  const files = [];
  const outDir = resolve(root, config.out);
  for (const t of config.text) walk(join(root, t), outDir, files);
  const set = baseChars();
  for (const f of files) {
    for (const ch of readFileSync(f, 'utf8')) {
      const cp = ch.codePointAt(0);
      // 控制字元、變體選擇符、私用區不要
      if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe000 && cp <= 0xf8ff)) continue;
      set.add(ch);
    }
  }
  return [...set].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
}

/** families 統一成 [{ family, text? }] */
export const familiesOf = (config) => config.families.map((f) => (typeof f === 'string' ? { family: f } : f));

/** 收了哪些字記在哪個檔：一般是 chars.txt，自己指定 text 的字型是 chars-<字型>.txt */
export const charsFile = (family, text) => (text ? `chars-${family}.txt` : 'chars.txt');

/** 原始碼用到、但字型裡沒有的字：{ 檔名: [字...] }，全部最新時是 {} */
export function missingChars(root) {
  const config = readConfig(root);
  const missing = {};
  for (const { family, text } of familiesOf(config)) {
    const name = charsFile(family, text);
    if (name in missing) continue;
    const file = join(root, config.out, name);
    const have = new Set(existsSync(file) ? readFileSync(file, 'utf8') : '');
    missing[name] = collectChars(root, text ? { ...config, text } : config).filter((c) => !have.has(c));
  }
  return Object.fromEntries(Object.entries(missing).filter(([, v]) => v.length));
}
