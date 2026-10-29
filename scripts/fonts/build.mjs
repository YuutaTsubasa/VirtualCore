// 產生遊戲要附的字型：node node_modules/virtual-core/scripts/fonts/build.mjs [遊戲資料夾，預設目前資料夾]
//
// 1. 讀遊戲的 fonts.config.json（要哪幾套字型 families、從哪裡收集字 text、輸出到 out；
//    families 也可以寫 { "family": "VSansJP", "text": ["src/lib/i18n/ja"] }，只收那些檔案裡的字，日文字型才不會太大）
// 2. 收集原始碼裡用到的字（src/fonts/chars.js）
// 3. 原始字型從官方下載到快取（%LOCALAPPDATA%\virtual-core\fonts 或 ~/.cache/virtual-core/fonts，不進 Git）
// 4. 用 fonttools 只留用到的字，寫成 WOFF2；再寫 fonts.css（@font-face）、chars.txt（收了哪些字）、licenses/
//
// 有哪些字型見 catalog.json（全部是可以附在遊戲裡的開放授權字型）。
// 改了介面文字之後重跑一次；遊戲的測試用 missingChars 檢查有沒有忘記。
// 需要 Python 與 fonttools、brotli（python -m pip install fonttools brotli）；Python 不叫 python 時設 PYTHON。
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectChars, readConfig, familiesOf, charsFile } from '../../src/fonts/chars.js';

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, 'catalog.json'), 'utf8'));
const root = resolve(process.argv[2] ?? '.');
const config = readConfig(root);
const out = resolve(root, config.out);
const cache = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'virtual-core', 'fonts') : join(homedir(), '.cache', 'virtual-core', 'fonts');
mkdirSync(cache, { recursive: true });

async function fetchCached(url, name) {
  const file = join(cache, name);
  if (!existsSync(file)) {
    console.log('下載', url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}：HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

const fileOf = (family, i) => `${family.toLowerCase()}${catalog[family].faces.length > 1 ? `-${i}` : ''}.woff2`;

// 舊的輸出清掉（換了 families 時不留沒用到的檔）
mkdirSync(join(out, 'licenses'), { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith('.woff2') || f.startsWith('chars')) rmSync(join(out, f));

const jobs = [];
const css = [
  '/* 自動產生，不要手改：node node_modules/virtual-core/scripts/fonts/build.mjs（VirtualCore 的 scripts/fonts）。',
  ' * 只收了原始碼裡用到的字（chars.txt）；玩家自己打的字（名字、聊天）沒收到時會落到系統字型。授權見 licenses/。 */',
];
let total = 0;
for (const { family, text: dirs } of familiesOf(config)) {
  const text = collectChars(root, dirs ? { ...config, text: dirs } : config).join('');
  writeFileSync(join(out, charsFile(family, dirs)), text);
  total = Math.max(total, [...text].length);
  const entry = catalog[family];
  if (!entry) throw new Error(`catalog.json 沒有 ${family}`);
  const license = await fetchCached(entry.license, `${family}-LICENSE.txt`);
  writeFileSync(join(out, 'licenses', `${family}.txt`), `${entry.note}\n${entry.faces.map((f) => f.url).join('\n')}\n\n${readFileSync(license, 'utf8')}`);
  for (const [i, face] of entry.faces.entries()) {
    const src = await fetchCached(face.url, decodeURIComponent(face.url.split('/').pop()));
    const file = fileOf(family, i);
    jobs.push({ src, out: join(out, file), text });
    css.push(`@font-face { font-family: '${family}'; src: url('./${file}') format('woff2'); font-weight: ${face.weight}; font-display: swap; }`);
  }
}

const python = process.env.PYTHON ?? 'python';
const r = spawnSync(python, [join(here, 'subset.py')], { input: JSON.stringify(jobs), stdio: ['pipe', 'inherit', 'inherit'] });
if (r.status !== 0) {
  console.error('子集化失敗；要先 python -m pip install fonttools brotli（或設 PYTHON 指到有裝的 Python）');
  process.exit(1);
}
writeFileSync(join(out, 'fonts.css'), css.join('\n') + '\n');
console.log(`寫好了 ${out}（${total} 字、${jobs.length} 個字型檔）`);
