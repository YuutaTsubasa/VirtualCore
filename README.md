# VirtualCore

[虛擬台麻館](https://github.com/YuutaTsubasa/TaiwanMahjong)系列（Virtual 系列）五款遊戲共用的程式（台麻從 0.8.0 起也接）：[虛擬台麻館](https://github.com/YuutaTsubasa/TaiwanMahjong)、[虛擬排球王](https://github.com/YuutaTsubasa/VirtualVolleyball)、[虛擬闖天下](https://github.com/YuutaTsubasa/VirtualQuest)、[虛擬跑跑樂](https://github.com/YuutaTsubasa/VirtualRunners)、[虛擬音鬥樂](https://github.com/YuutaTsubasa/VirtualBeatBattle)。

以前每款都是複製上一款再改，同一份程式有五份；改一個共通功能要改五次。現在共用的部分放這裡，各遊戲用 git tag 引用。

## 內容

| 路徑 | 是什麼 | 遊戲怎麼用 |
| --- | --- | --- |
| `src/audio/synth.js` | PC-98 風 FM 音源（YM2608 的 FM／SSG／Rhythm，Web Audio 即時合成）、MML 解析、和弦 | `import { fmNote, parseMML } from 'virtual-core/audio/synth.js'` |
| `src/audio/music.js` | 曲子播放器（lookahead 排程）與 `compile`（曲子展開成事件，譜面產生器用）。`play(song, { at, repeat, onEnd })` 可以指定開始的 AudioContext 時間、整首重複幾次，回傳實際開始時間。曲目由遊戲自己的 `songs.js` 提供 | `import { Player, compile } from 'virtual-core/audio/music.js'` |
| `src/net/p2p.js` | 線上房間的 WebRTC 傳輸（ctrl／fast 兩個資料通道），配對走 `workers/signal` | `import { P2PHost, P2PGuest, setTranslator } from 'virtual-core/net/p2p.js'`；啟動時 `setTranslator(t)` |
| `src/net/site.js` | 房號、分享連結、配對服務網址的設定 | 遊戲的 `src/lib/site.js` 用 `signalServer(env.VITE_SIGNAL_SERVER, 預設網址)` |
| `src/input/controls.js` | 手把／鍵盤操作選單的純函式：手把轉成 Arrow／A／B／Start／LB／RB 指令（按住會連發）、非標準手把的十字鍵（hat 軸、axes 6／7）、焦點往哪個按鈕移、秘技序列、拉桿與虛擬鍵盤 | `import { gamepadCommands, padDpad } from 'virtual-core/input/controls.js'`；畫面那側（`Controls.svelte`）留在遊戲 |
| `src/i18n/lang.js` | 多國語言的純函式：語言清單、偵測／存取語言、字典合併、`translate`（原文當 key）、伺服器訊息比對、網頁 lang／標題。沒有 Svelte rune，字典與目前語言的 `$state` 留在遊戲的 `i18n.svelte.js` | `import { translate, loadLang, mergeDicts } from 'virtual-core/i18n/lang.js'` |
| `crates/virtual-room/` | Rust：連線房間（不碰網路，可編成 WebAssembly）。`Lobby`（座位、房主、聊天、入席／離席／斷線、電腦補位）、`protocol::handle`（hello／sit／input／chat／host 指令）、`host::HostRoom`（線上房間的房主）、`Difficulty`。遊戲實作 `Game`（座位數、提示文字、角色、設定）與 `RoomGame`（開始、每格前進、輸入、自己的房主指令；比賽中斷線／離席預設由電腦接手，可以改成算棄權） | `virtual-room = { git = "https://github.com/YuutaTsubasa/VirtualCore", tag = "v0.7.0" }`；遊戲的 `Room` 放一個 `Lobby` 加比賽狀態 |
| `crates/virtual-lan/` | Rust：區網房間伺服器（axum，`/ws`＋網頁靜態檔，每秒 60 格廣播）。房主的 App 內建或 `npm run server` 單獨跑 | `virtual_lan::start(port, room, assets, "虛擬排球王伺服器")` |
| `workers/signal/` | 配對服務（Cloudflare Workers＋Durable Object），只轉送 offer／answer／ICE | 每款部署成自己名字的 worker：`npm --prefix workers/signal run deploy:volleyball` |
| `src/fonts/chars.js`、`scripts/fonts/` | 附在遊戲裡的字型：`catalog.json` 列出可以用的開放授權字型（VSans＝Noto Sans TC、VKai＝霞鶩文楷 TC、VPixel＝俐方體 11 號、VMono＝Cascadia Mono、VSerif＝Noto Serif、VSansJP＝Noto Sans JP、VKaiJP＝Klee One）；`build.mjs` 收集遊戲原始碼用到的字、下載原始字型（快取在 `%LOCALAPPDATA%irtual-coreonts`）、用 fonttools 只留那些字寫成 WOFF2＋`fonts.css`。系統字型各平台不同（Android 沒有正黑體、標楷體、細明體），所以五款都用附帶的字型 | 遊戲根目錄放 `fonts.config.json`，`npm run fonts`（`node node_modules/virtual-core/scripts/fonts/build.mjs`；要先 `python -m pip install fonttools brotli`）；`main.js` 匯入 `./fonts/fonts.css`；測試用 `missingChars` 檢查有沒有忘了重產 |
| `.github/workflows/build-apps.yml` | 可重用 workflow：Windows／Linux／macOS×2／Android／iOS 模擬器打包，`v*` tag 附到 Release | `uses: YuutaTsubasa/VirtualCore/.github/workflows/build-apps.yml@v0.7.0` |
| `.github/workflows/pages.yml` | 可重用 workflow：測試後把網頁版部署到 GitHub Pages | `uses: YuutaTsubasa/VirtualCore/.github/workflows/pages.yml@v0.7.0` |

用法範例寫在各 workflow 檔案的開頭。

## 遊戲怎麼引用

```jsonc
// package.json
"dependencies": { "virtual-core": "github:YuutaTsubasa/VirtualCore#v0.7.0" }
```

```toml
# crates/<遊戲>-core/Cargo.toml、crates/<遊戲>-wasm/Cargo.toml
virtual-room = { git = "https://github.com/YuutaTsubasa/VirtualCore", tag = "v0.7.0" }
# src-tauri/Cargo.toml
virtual-lan = { git = "https://github.com/YuutaTsubasa/VirtualCore", tag = "v0.7.0" }
```

npm 直接從 GitHub 裝這個 tag，不發佈到 npm；`package-lock.json`／`Cargo.lock` 會記下 commit，建置可以重現。`.svelte`／`.js` 原始碼由遊戲自己的 Vite 編譯。

本機同時改 VirtualCore 和遊戲時，在遊戲資料夾 `npm install ../VirtualCore` 暫時換成本機版本；Rust 在遊戲根目錄放 `.cargo/config.toml`（不要 commit）：

```toml
[patch."https://github.com/YuutaTsubasa/VirtualCore"]
virtual-room = { path = "../VirtualCore/crates/virtual-room" }
virtual-lan = { path = "../VirtualCore/crates/virtual-lan" }
```

改完、VirtualCore 打好 tag 再換回去。

## 發版

1. 改動走 PR，`npm test` 與 Rust 的 `cargo test`（`crates/virtual-room`）通過。
2. 合併後打 tag：`git tag v0.7.0 && git push origin v0.7.0`。npm 套件與可重用 workflow 用同一個 tag。
3. 各遊戲各開一個 PR，把 `package.json` 和 workflow 的版本改到新 tag。

## 授權

程式碼 MIT（見 `LICENSE`）。
