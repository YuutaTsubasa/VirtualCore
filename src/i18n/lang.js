// 多國語言的共用部分，Virtual 系列五款共用（做法最早來自 TaiwanMahjong）：原文（繁體中文）本身就是翻譯的 key。
//   translate(dict, '開始比賽')                → 'Start match'
//   translate(dict, '{name} 獲勝！', { name }) → '{name} wins!'
// 找不到翻譯就顯示原文，所以漏翻只會顯示中文，不會壞掉。
//
// 這裡只放沒有 Svelte rune 的純函式。遊戲自己的 src/lib/i18n.svelte.js 留著：
// 字典（import.meta.glob 要寫在遊戲裡）、目前語言的 $state、localStorage key（vb_lang…）、
// 網頁標題、伺服器訊息的句型。

export const LANGUAGES = [
  { id: 'zh-TW', name: '中文', htmlLang: 'zh-Hant-TW' },
  { id: 'en', name: 'English', htmlLang: 'en' },
  { id: 'ja', name: '日本語', htmlLang: 'ja' },
];

export const isLang = (id) => LANGUAGES.some((l) => l.id === id);

export const htmlLangOf = (id) => LANGUAGES.find((l) => l.id === id)?.htmlLang ?? 'zh-Hant-TW';

/** import.meta.glob('./i18n/*\/*.js', { eager: true }) 的結果合成 { 語言: { 原文: 譯文 } } */
export function mergeDicts(modules) {
  const dicts = {};
  for (const [path, mod] of Object.entries(modules)) {
    const lang = path.split('/').at(-2);
    dicts[lang] = { ...(dicts[lang] ?? {}), ...mod.default };
  }
  return dicts;
}

/** 沒選過語言時看瀏覽器：第一個認得的語言（中文任何地區都用中文），都不認得就用英文；拿不到瀏覽器語言就用中文 */
export function detectLang(saved, navLanguages = []) {
  if (isLang(saved)) return saved;
  if (navLanguages.length === 0) return 'zh-TW';
  for (const l of navLanguages) {
    if (/^zh/i.test(l ?? '')) return 'zh-TW';
    if (/^ja/i.test(l ?? '')) return 'ja';
    if (/^en/i.test(l ?? '')) return 'en';
  }
  return 'en';
}

/** 讀存起來的語言（沒有就看瀏覽器）；storageKey 用遊戲前綴，例如 vb_lang */
export function loadLang(storageKey) {
  let saved = null;
  try {
    saved = localStorage.getItem(storageKey);
  } catch {
    // 讀不到就看瀏覽器
  }
  const nav = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  return detectLang(saved, nav);
}

export function saveLang(storageKey, id) {
  try {
    localStorage.setItem(storageKey, id);
  } catch {
    // 存不了就算了
  }
}

/** 把 {name} 之類的位置換成 params 的值（沒給的保留原樣） */
export function format(text, params) {
  return params ? text.replace(/\{(\w+)\}/g, (m, k) => params[k] ?? m) : text;
}

/** 翻譯一段原文；dict 是目前語言的字典（中文介面沒有字典，直接回原文） */
export function translate(dict, text, params) {
  if (text == null) return '';
  return format(dict?.[text] ?? text, params);
}

/**
 * 伺服器整句送來的訊息：先查字典，再依序比對句型。
 * patterns 是 [正規表示式, (match) => 翻好的字串] 的陣列。
 */
export function matchServerText(dict, patterns, text) {
  if (!text) return text;
  if (dict?.[text]) return dict[text];
  for (const [re, fn] of patterns) {
    const m = re.exec(text);
    if (m) return fn(m);
  }
  return text;
}

/** 網頁的 lang 屬性與標題跟著語言換 */
export function applyDocument(lang, title) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = htmlLangOf(lang);
  if (title) document.title = title;
}
