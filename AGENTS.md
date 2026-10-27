# Virtual 系列共通規則

`%USERPROFILE%\Data\10_Projects\Virtual\` 放「虛擬台麻館」宇宙的五款遊戲，每款一個公開 repo，加上共用程式 `VirtualCore`（本 repo）：

| 資料夾 | 遊戲 | 預設分支 | Rust crate 前綴 | dev 埠 |
| --- | --- | --- | --- | --- |
| `TaiwanMahjong` | 虛擬台麻館（麻將，含 MCP／HTTP API） | `master` | `mahjong-` | server 7777 |
| `VirtualVolleyball` | 虛擬排球王（1v1） | `main` | `volleyball-` | 1421 |
| `VirtualQuest` | 虛擬闖天下（清版，4 人） | `main` | `quest-` | 1422 |
| `VirtualRunners` | 虛擬跑跑樂（跑酷，8 人） | `main` | `runner-` | 1423 |
| `VirtualBeatBattle` | 虛擬音鬥樂（節奏，12 人） | `main` | `beat-` | 1424 |
| `VirtualCore` | 共用程式：FM 音源、WebRTC、配對服務、CI workflow | `main` | — | — |

技術都一樣：Tauri v2＋Svelte 5＋Vite 6，遊戲引擎是 Rust（網頁版用 `wasm-pack` 編成 WebAssembly），PC-98 風 FM 音源，WebRTC（Cloudflare Worker 配對）與區網 WebSocket 開房，中／英／日三語，五種畫風。

這份檔案是**系列共通規則**（正本在 VirtualCore；`Virtual\CLAUDE.md` 匯入它，Claude 在任何一款 repo 裡都讀得到）；電腦本身與 AI 工作階段的規則在 `%USERPROFILE%\Data\10_Projects\tailsmachine-ops\AGENTS.md`，進度寫在那個 repo 的 `projects/virtual/STATUS.md`。各遊戲 repo 自己的 README 寫該遊戲的玩法與建置細節。

## 開始工作前

1. 讀 tailsmachine-ops 的 `projects/virtual/STATUS.md`。
2. 要動到下面「共通層」任何一塊時，先讀 `projects/virtual/notes/2026-10-27_inventory-and-architecture.md` 的盤點表，知道這塊在五款裡差多少。
3. 接到新 feature 或 bug，先照下面的「功能判斷」分類，再動手。完整流程是 tailsmachine-ops 的 skill `skills/virtual-feature-triage/SKILL.md`。

## 共通層與遊戲層

**共通層**（五款都有、行為應該一樣）：

- 音訊：FM 音源 `audio/synth.js`、播放器 `audio/music.js`、音效機制 `audio/sound.svelte.js`、`game/audio.js`
- 連線：`p2p.js`、`net.svelte.js`、`local/host-worker.js`、`workers/signal/`、Rust `protocol.rs`、`room.rs` 的座位／房主／聊天／補電腦、`src-tauri/src/server.rs`
- 大廳 UI：`Lobby`、`RoomEntry`（骨架共通，房間規則設定是遊戲層）
- 多國語系：`i18n.svelte.js`、`i18n/*/ui.js` 的共通字串、`i18n/*/characters.js`
- 輸入：`input-controls.js`（手把／鍵盤焦點導覽）、`Controls`、`ControlsKeyboard`、`game/input.js` 的鍵位設定
- 畫風：`art-style.svelte.js`、`style-assets.js`、`skins.css`、五種畫風的名稱與切換
- 角色：十一位角色的 id、名字、簡介、顏色、立繪（`public/characters/`）；阿翼是隱藏角色
- 設定與存檔機制：`SettingsDialog` 的共通項目（語言、音量、畫風、手把）、`localStorage` 的 key 命名
- Tauri 外殼：`src-tauri/src/lib.rs`、`tauri.conf.json` 的結構、`capabilities/`
- 建置與發版：`.github/workflows/build-apps.yml`（六平台、`v*` tag 附 Release）、`pages.yml`、`vite.config.js`、`package.json` scripts、共通模組的測試

**遊戲層**：`engine.js`、`game/render.js`、`scenery.js`、`stages.js`、Rust 的 `game.rs`／`run.rs`／`play.rs`／`ai.rs`、角色在這款的能力值與必殺、關卡、譜面、曲目內容、遊戲專用的 UI（`SelectScreen`、`TouchControls`…）與美術。

## 功能判斷（摘要）

問三題：

1. **玩家會不會期待其他四款也一樣？**（例：手把熱插拔提示、聊天側欄、新語言、新畫風、新角色）→ 會，就是 **共通**。
2. **它改的是規則、物理、關卡、計分嗎？** → 是，就是 **個別玩法**。
3. **兩者都有？**（例：新角色＝名單與立繪共通＋各款能力值；新房間選項＝大廳 UI 共通＋各款規則）→ **共通機制＋各款內容**，拆成兩部分處理。

分類結果用標籤記在 issue 上（見下）。沒有把握時，當作共通來設計、只在一款先上線，並在追蹤 issue 寫清楚其他款要不要跟。

## 共通功能怎麼做

**已經在 `VirtualCore` 的模組**（見 VirtualCore 的 README「內容」）：

- 在 VirtualCore 改、加測試、開 PR；使用者合併後打 tag（`vX.Y.Z`，同一個 tag 同時給 npm 套件與可重用 workflow 用）。
- 各款 repo 各開一個 PR，把 `package.json` 的 `virtual-core` 與 workflow 的 `@vX.Y.Z` 改到新 tag，`npm install` 更新 lock，跑該款的測試。
- 本機同時改核心和遊戲時，在遊戲資料夾 `npm install ../VirtualCore`（暫時，不要 commit 這個改動），改完再換回 tag。

**還沒搬進 VirtualCore 的模組**：

- 先在**一款**做好並測過（通常選差異最小、最新的那款；連線相關選 `VirtualVolleyball`，它是 Virtual 範本的源頭），再移植到其他款。
- 移植時以盤點表為準：🟢 的檔案可以整份覆蓋（只改名稱、網址）；🟡 的檔案只移植那一段改動，不要整份覆蓋，否則會蓋掉該款自己加的東西。
- 每款一個 PR，標題用同一個前綴（例：`[common] 手把熱插拔提示`），內文連到追蹤 issue。全部合併、各自發版後，追蹤 issue 才關。
- 台麻（TaiwanMahjong）比其他四款舊一輪、結構不同：共通功能要另外評估怎麼接，不能直接覆蓋檔案。

## 標籤與跨 repo 追蹤

| 標籤 | 意思 |
| --- | --- |
| `virtual:common` | 共通功能，五款都要（或明確列出例外） |
| `virtual:shared-partial` | 共通機制，但只有部分遊戲需要（例：只有多人連線的款） |
| `virtual:game` | 這款自己的玩法 |
| `virtual:port` | 把別款已經做好的共通改動移植到這款 |

- 追蹤 issue 開在 VirtualCore（只跟一款有關、還沒決定要不要推廣的，開在那款），用 GitHub 的 sub-issue 掛上每款的 `virtual:port` issue（sub-issue 可以跨 repo）。
- 另開一個使用者層級的 GitHub Project「Virtual 系列」，五個 repo 的 issue 都加進去，用「Game」欄位看哪款還沒跟上。
- 標籤與 Project 還沒建立；建立前先問使用者。

## 共通慣例

- `localStorage` key 用遊戲前綴：台麻 `mj_`、排球 `vb_`、闖天下 `vq_`、跑跑樂 `vr_`、音鬥樂 `vbb_`。五款網頁版都在 `yuuta-tsubasa.studio` 同一個網域，**localStorage 互相看得到**：不要用沒有前綴的 key；要做系列共通設定時，用 `virtual_` 前綴並先問使用者。
- 區網埠每款不同（台麻 7777、排球 7788、跑跑樂 7811…），新遊戲要挑不撞的。
- 程式碼註解、commit 訊息、README 都用繁體中文（照各 repo 現有慣例）。
- 美術草稿不要再塞進 `docs/art/`，repo 已經很大；新草稿放 `art-inbox/`（已有的流程）或 repo 外。
- 版本、tag、Release、GitHub Pages 網址、App identifier 是對外公開的，改之前先問使用者。

## AI 工作階段規則

- 分支用 `claude/<主題>`（Codex 用 `codex/<主題>`）；**只有使用者合併**。
- 這五個 repo 目前沒有分支保護，以前都直接推 `main`；改成走 PR 之前，推送前先問使用者。
- 一個工作階段一次只改一款；要同時改多款時，每款各開 worktree 或依序做，不要在一個 commit 裡碰兩個 repo。
- 在本機用 ROM 以外的完整建置（`npm run tauri build`、六平台打包）算重工作，先拿 tailsmachine-ops 規定的 `heavy-build` 鎖；`npm run dev`、`npm test`、`cargo test` 不用。
