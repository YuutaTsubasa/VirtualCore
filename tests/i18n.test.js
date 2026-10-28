import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLang, mergeDicts, translate, format, matchServerText, htmlLangOf, isLang } from '../src/i18n/lang.js';

test('saved language wins, then the first recognised browser language, then English', () => {
  assert.equal(detectLang('ja', ['en-US']), 'ja');
  assert.equal(detectLang('xx', ['fr-FR', 'zh-HK', 'en']), 'zh-TW', '中文任何地區都用中文');
  assert.equal(detectLang(null, ['fr-FR', 'ja-JP']), 'ja');
  assert.equal(detectLang(null, ['fr-FR']), 'en');
  assert.equal(detectLang(null, []), 'zh-TW', '拿不到瀏覽器語言就用中文');
});

test('dictionaries from import.meta.glob merge per language', () => {
  const dicts = mergeDicts({
    './i18n/en/ui.js': { default: { 開始: 'Start' } },
    './i18n/en/characters.js': { default: { 小翠: 'Tsui' } },
    './i18n/ja/ui.js': { default: { 開始: 'スタート' } },
  });
  assert.deepEqual(dicts, { en: { 開始: 'Start', 小翠: 'Tsui' }, ja: { 開始: 'スタート' } });
});

test('translate falls back to the original text and fills {params}', () => {
  const en = { '{name} 獲勝！': '{name} wins!' };
  assert.equal(translate(en, '{name} 獲勝！', { name: 'Tsui' }), 'Tsui wins!');
  assert.equal(translate(undefined, '{name} 獲勝！', { name: '小翠' }), '小翠 獲勝！');
  assert.equal(translate(en, '沒翻的字'), '沒翻的字');
  assert.equal(translate(en, null), '');
  assert.equal(format('{a} − {b}', { a: 3 }), '3 − {b}', '沒給的參數保留原樣');
});

test('server text: whole sentences first, then patterns, else unchanged', () => {
  const en = { 座位已滿: 'No seats left' };
  const patterns = [[/^(.*) 離開了座位$/, (m) => `${m[1]} left`]];
  assert.equal(matchServerText(en, patterns, '座位已滿'), 'No seats left');
  assert.equal(matchServerText(en, patterns, '小翠 離開了座位'), '小翠 left');
  assert.equal(matchServerText(en, patterns, '別的訊息'), '別的訊息');
  assert.equal(matchServerText(en, patterns, ''), '');
});

test('html lang attribute per language', () => {
  assert.equal(htmlLangOf('zh-TW'), 'zh-Hant-TW');
  assert.equal(htmlLangOf('ja'), 'ja');
  assert.equal(isLang('en'), true);
  assert.equal(isLang('fr'), false);
});
