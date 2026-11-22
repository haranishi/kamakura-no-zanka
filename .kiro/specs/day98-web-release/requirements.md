# 要件定義：残火の鎌倉 Day98 Web公開準備（第一章「隠れ谷の灯」）

## ユーザーストーリー

1. **スマホで X や 100日一覧から開いた人**として、登録やインストールなしにタイトル画面を読み、初回容量（約77MB・Wi-Fi推奨）を把握したうえで、そのまま親指操作で廃寺から水穂の里の救出・戦闘・帰還まで遊び、遊び終えたら X・LINE・端末共有・リンクコピーで友だちに送りたい。
2. **PC ブラウザで開いた人**として、これまでどおりキーボードとマウス（ポインターロック）で違和感なく第一章を遊べ、操作説明・設定・権利表記・共有へ迷わず辿り着きたい。
3. **運営・保守する本人**として、既存リポジトリの `/`（v18 庭）や 2,271 件の自動テストを壊さずに、Cloudflare Pages（`https://day98.rairakku.com/`）へそのまま出せる検証済みパッケージを再現可能に組み立てたい。

## UX 5階層（戦略 → 要件 → 構造 → 骨格 → 表層）

- **戦略**：100日チャレンジ Day98 の目玉3D作品として、「ブラウザだけで遊べる時代劇アクション」を URL 1本で届ける。外部通信・ログイン・DB はゼロを保つ。
- **要件**：① `/` 即起動の Pages 出力、② PC 操作無劣化＋スマホタッチ操作＆自動軽量品質、③ SNSシェア4点セット・OGP・canonical・権利/出典モーダル、④ 厳格な CSP / セキュリティヘッダー・404、⑤ 公開ゲート検証。
- **構造**：ローカル開発（`dist/`）は `/`＝v18 庭・`/valley/`＝第一章を維持。公開出力（`npm run build:pages` → `.pages-dist/`）では第一章をルート `/` に昇格し、`/valley/*` は `/` へ 301 転送する。
- **骨格**：タッチ操作は `touch-math.js`（純粋層）＋ `valley-touch.js`（DOM/入力）＋ `valley-touch.css`（`html.kz-touch` 配下限定）に分離。右下の操作弧は常時5ボタン（斬る・受ける・避ける・強斬り・調べる/とどめ/闇討ち）に絞り、補助（屈む・狙う・風）を上部の小型ピルへ、仲間指示を既存 `#party` タップへ統合する。
- **表層**：既存の墨（`#171e1b`）・和紙（`#eee9dc`）・控えめな朱（`#b65b46`）・金（`#e9c98d`）と明朝・ゴシックを継承。色だけに頼らずラベル変化と枠のコントラスト（3:1 以上・44px 以上）で状態を示す。

## 機能・非機能要件（WR1〜WR9）

- **WR1（ルート公開パッケージ）**：`npm run build:pages` が `.pages-dist/` に第一章単体（`index.html`、`valley/`、`vendor/`、`assets/characters/`、`assets/valley/`、`audio.js`、`og.jpg`、`favicon.svg`、`404.html`、`_headers`、`_redirects`、ライセンス文書群）を組み立て、v18 の `scene.glb`・開発ページ（`lab/viewer/world`）・`kamakura-*`・`world-private` を含めない。単一ファイル 25 MiB 未満。
- **WR2（タッチ検出と PC 非影響）**：`?touch=1|0` 最優先、未指定時は `(pointer: coarse)` で有効、それ以外は初回 `pointerType === 'touch'` で有効。`html.kz-touch` が無い PC 環境では描画・HUD・入力を一切変えない。
- **WR3（タッチ移動・視点・戦闘・会話）**：左領域フローティングスティック（不感帯・アナログ移動・外縁 `1.4R` で走り＋ヒステリシス）、右領域ドラッグ視点、右下5ボタン（斬る／受ける長押し／避ける／強斬り／調べる・とどめ・闇討ち）、補助ピル（屈む／狙う／風）と `#party` タップ（仲間指示）。タッチ時はポインターロックを要求せず、会話・オープニング・節目演出をタップ（戦闘演出は0.6秒長押し）で進められる。2本目の指でのボタンタップ（`onTap`）と、タッチ時のみ近接360度補助（間合い 3.6m）を備える。
- **WR4（スマホ向け品質・表示）**：`?q=` も保存値も無いタッチ端末は初期品質を `'light'` にする。プレイ中の縦向きでは閉じられる横向き推奨バナーを出し、タイトル・ロード・休止・結果・選択・死亡の各画面は 390×844 / 844×390 / 568×320 で横はみ出し 0・ボタン切れ 0 とする。
- **WR5（SNSシェア4点セット）**：タイトル画面（`aria-label="このアプリを共有する"` で開く共有ダイアログ）と結果画面に、X・LINE・`navigator.share`（対応端末のみ）・リンクコピー＋Instagram/YouTube 注記を備える。ボタン高さ 44px 以上、枠コントラスト 3:1 以上、`canonical` URL を共有する。
- **WR6（OGP・canonical・権利表記・容量案内）**：公開 `index.html` に `canonical`・`og:title`・`og:description`・`og:url`・`og:image`（1200×630 実在画像）・`twitter:card=summary_large_image`・`favicon.svg` を入れる。ロード画面に約77MB（Wi-Fi推奨）を明示し、タイトルから開ける「権利・出典」ダイアログに MIT・CC BY 4.0・Three.js・Poly Haven・CMU・Meshy・創作注記を載せる。
- **WR7（セキュリティヘッダーと 404）**：`_headers` に `Content-Security-Policy`（`script-src 'self' 'sha256-...'`・`connect-src 'self' blob:`・`img-src 'self' data: blob:`・`frame-ancestors 'none'`・`object-src 'none'`）、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`Permissions-Policy` を設定し、`404.html` を用意する。
- **WR8（公開ゲート検証）**：`npm run verify:pages` が静的契約（容量・相対リンク・禁止ファイル除外・CSPハッシュ・OGP/canonical）を検証し、実ブラウザ検査ツールが本番と同一の CSP 下で PC/スマホ幅の起動・タッチ操作・共有ダイアログ・コンソール/ページエラー0・外部通信0を確認できる。
- **WR9（既存回帰ゼロ）**：`npm test && npm run check && npm run smoke` がすべて通ること。
