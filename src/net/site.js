// 線上房間（WebRTC P2P）的房號與分享連結，Virtual 系列共用。
// 配對服務的網址每款遊戲不同，由遊戲自己的 src/lib/site.js 用 signalServer() 決定。

// 配對服務網址：setting 是 VITE_SIGNAL_SERVER，沒設定就用 fallback（遊戲已部署的那一個）。
// 寫 off 表示不提供線上房間（回傳空字串，介面上相關的選項會藏起來）。
export function signalServer(setting, fallback) {
  const s = setting || fallback || '';
  return s === 'off' ? '' : s.replace(/\/$/, '');
}

// 房號用的字元（去掉容易看錯的 0/O、1/I/L）
export const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// 房號：5 個英文或數字，至少有一個英文字母（只打數字視為通訊埠）
export function isRoomCode(text) {
  return /^[A-Za-z0-9]{5}$/.test(text || '') && /[A-Za-z]/.test(text);
}

// 從分享連結（…#join/K7QX2）或直接輸入的文字取出房號；不是房號就回傳 null
export function roomCodeOf(text) {
  text = (text || '').trim();
  const m = /#join\/([A-Za-z0-9]{5})\b/.exec(text);
  const code = m ? m[1] : text;
  return isRoomCode(code) ? code.toUpperCase() : null;
}

// 分享連結：base 是網頁版的網址（沒有就回傳空字串）
export function shareLink(code, base) {
  if (!base || !code) return '';
  return `${base.replace(/#.*$/, '')}#join/${code}`;
}
