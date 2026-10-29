// 字型子集化要收哪些字（src/fonts/chars.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectChars, missingChars, baseChars } from '../src/fonts/chars.js';

const catalog = JSON.parse(readFileSync(new URL('../scripts/fonts/catalog.json', import.meta.url), 'utf8'));

function game() {
  const root = mkdtempSync(join(tmpdir(), 'vc-fonts-'));
  mkdirSync(join(root, 'src/i18n/ja'), { recursive: true });
  mkdirSync(join(root, 'src/fonts'), { recursive: true });
  mkdirSync(join(root, 'node_modules/x'), { recursive: true });
  writeFileSync(join(root, 'src/a.svelte'), '<p>虛擬台麻館</p>');
  writeFileSync(join(root, 'src/i18n/ja/ui.js'), "export default { '開始': 'スタート' };");
  writeFileSync(join(root, 'src/fonts/chars.txt'), '不該被收');
  writeFileSync(join(root, 'node_modules/x/b.js'), '龘');
  writeFileSync(join(root, 'src/c.png'), '圖');
  const config = { out: 'src/fonts', text: ['src'], families: ['VSans', { family: 'VSansJP', text: ['src/i18n/ja'] }] };
  writeFileSync(join(root, 'fonts.config.json'), JSON.stringify(config));
  return { root, config };
}

test('collects characters from source files only', () => {
  const { root, config } = game();
  const chars = new Set(collectChars(root, config));
  for (const c of '虛擬台麻館開始ス') assert.ok(chars.has(c), c);
  // 輸出資料夾、node_modules、非原始碼檔案不收
  for (const c of '該龘圖') assert.ok(!chars.has(c), c);
  // ASCII 與假名一定有
  assert.ok(chars.has('A') && chars.has('あ') && baseChars().has('、'));
});

test('missingChars reports each chars file', () => {
  const { root, config } = game();
  const missing = missingChars(root);
  assert.ok(missing['chars.txt'].includes('虛'));
  assert.ok(missing['chars-VSansJP.txt'].includes('ス'));
  writeFileSync(join(root, 'src/fonts/chars.txt'), collectChars(root, config).join(''));
  writeFileSync(join(root, 'src/fonts/chars-VSansJP.txt'), collectChars(root, { ...config, text: ['src/i18n/ja'] }).join(''));
  assert.deepEqual(missingChars(root), {});
});

test('catalog fonts all have a license and weights', () => {
  for (const [family, f] of Object.entries(catalog)) {
    assert.match(f.license, /^https:\/\//, family);
    assert.ok(f.faces.length && f.faces.every((x) => /^https:\/\//.test(x.url) && /^\d+ \d+$/.test(x.weight)), family);
  }
});
