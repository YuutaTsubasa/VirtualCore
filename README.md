# VirtualCore

[虛擬台麻館](https://github.com/YuutaTsubasa/TaiwanMahjong)系列（Virtual 系列）五款遊戲共用的程式：[虛擬台麻館](https://github.com/YuutaTsubasa/TaiwanMahjong)、[虛擬排球王](https://github.com/YuutaTsubasa/VirtualVolleyball)、[虛擬闖天下](https://github.com/YuutaTsubasa/VirtualQuest)、[虛擬跑跑樂](https://github.com/YuutaTsubasa/VirtualRunners)、[虛擬音鬥樂](https://github.com/YuutaTsubasa/VirtualBeatBattle)。

以前每款都是複製上一款再改，同一份程式有五份；改一個共通功能要改五次。現在共用的部分放這裡，各遊戲用 git tag 引用。

## 內容

| 路徑 | 是什麼 | 遊戲怎麼用 |
| --- | --- | --- |
| `src/audio/synth.js` | PC-98 風 FM 音源（YM2608 的 FM／SSG／Rhythm，Web Audio 即時合成）、MML 解析、和弦 | `import { fmNote, parseMML } from 'virtual-core/audio/synth.js'` |
| `src/audio/music.js` | 曲子播放器（lookahead 排程）。曲目由遊戲自己的 `songs.js` 提供 | `import { Player } from 'virtual-core/audio/music.js'` |
| `src/net/p2p.js` | 線上房間的 WebRTC 傳輸（ctrl／fast 兩個資料通道），配對走 `workers/signal` | `import { P2PHost, P2PGuest, setTranslator } from 'virtual-core/net/p2p.js'`；啟動時 `setTranslator(t)` |
| `src/net/site.js` | 房號、分享連結、配對服務網址的設定 | 遊戲的 `src/lib/site.js` 用 `signalServer(env.VITE_SIGNAL_SERVER, 預設網址)` |
| `workers/signal/` | 配對服務（Cloudflare Workers＋Durable Object），只轉送 offer／answer／ICE | 每款部署成自己名字的 worker：`npm --prefix workers/signal run deploy:volleyball` |
| `.github/workflows/build-apps.yml` | 可重用 workflow：Windows／Linux／macOS×2／Android／iOS 模擬器打包，`v*` tag 附到 Release | `uses: YuutaTsubasa/VirtualCore/.github/workflows/build-apps.yml@v0.1.0` |
| `.github/workflows/pages.yml` | 可重用 workflow：測試後把網頁版部署到 GitHub Pages | `uses: YuutaTsubasa/VirtualCore/.github/workflows/pages.yml@v0.1.0` |

用法範例寫在各 workflow 檔案的開頭。

## 遊戲怎麼引用

```jsonc
// package.json
"dependencies": { "virtual-core": "github:YuutaTsubasa/VirtualCore#v0.1.0" }
```

npm 直接從 GitHub 裝這個 tag，不發佈到 npm；`package-lock.json` 會記下 commit，建置可以重現。`.svelte`／`.js` 原始碼由遊戲自己的 Vite 編譯。

本機同時改 VirtualCore 和遊戲時，在遊戲資料夾 `npm install ../VirtualCore` 暫時換成本機版本（這個改動不要 commit），改完、VirtualCore 打好 tag 再換回去。

## 發版

1. 改動走 PR，`npm test` 通過。
2. 合併後打 tag：`git tag v0.2.0 && git push origin v0.2.0`。npm 套件與可重用 workflow 用同一個 tag。
3. 各遊戲各開一個 PR，把 `package.json` 和 workflow 的版本改到新 tag。

## 授權

程式碼 MIT（見 `LICENSE`）。
