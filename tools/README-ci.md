# 合成データで鎌倉の描画を検査する

Node 22以上とGoogle Chromeが必要です。npmの追加インストールはありません。
Linuxでは `google-chrome`、macOSでは通常のGoogle Chromeを使います。
別の配置なら `CHROME_BIN` に実行ファイルを指定してください。

```sh
node tools/make-synthetic-world.mjs .work/ci-world
KZ_WORLD_DIR="$PWD/.work/ci-world" npm start
```

別の端末で実行します。

```sh
NODE_OPTIONS=--max-old-space-size=1536 timeout 300 node tools/gl-smoke.mjs
```

既定の接続先は `http://127.0.0.1:8080`、出力先は `reports/local/gl-smoke` です。
`GL_SMOKE_URL` と `GL_SMOKE_OUT` で変更できます。
本物のカーソルを動かさないよう、読み込み前にマウス固定を置き換えます。
Chromeのプロファイルは実行ごとに作り、成功・失敗のどちらでも削除します。

## 失敗したら result.json と PNG を確認する

北向き・堂の前・海岸の3画角で、HUDと地面の準備完了を待ってPNGを保存します。
コンソールのerror/warning、ページ例外、HTTPエラー、読み込み失敗、HUDの通知を失敗とします。
`result.json` に判定・回収したエラー・撮影名、`chrome.log` にChromeの末尾ログを残します。
失敗時は追加の撮影も試みます。Chrome起動前の失敗ではPNGはありません。

既知の無害な警告だけ、`tools/ci-smoke-allowlist.json` に
`level: "warning"`、完全一致する `message`（ドライバーの実行ごとの文脈アドレス `0x…` は無視して比べる）、根拠を示す `reason` を追加します。
最初に入れたのは、Chrome の性能の通知「GPU stall due to ReadPixels」だけです。シェーダーエラーは除外できません。

故障の検出を確認するには、別の出力先で次を実行します。非0終了が期待値です。

```sh
GL_SMOKE_OUT=reports/local/gl-smoke-bad NODE_OPTIONS=--max-old-space-size=1536 timeout 300 node tools/gl-smoke.mjs --inject-bad-glsl
```

CIは非0終了に加え、`shaderFailure: true` を確認します。
サーバー起動失敗だけで検出力の確認が成功することはありません。

## 合成データは数学的な形だけから作る

固定seed 731、256×256格子、地面分類0〜7、川27本、道、部品付きの家、
暗い内壁と床を持つ堂、針葉樹・広葉樹・林分を生成します。
外部の地形や素材は読みません。GLBも箱と屋根からその場で組み立てます。
生成物は人工の検査素材としてプロジェクトのMITライセンスで提供します。
バイナリはコミットせず、CIごとに生成します。

単体試験は決定性・8MB以下・データの復号・宣言された全ファイルの配信・
GLSL差し込み・エラー分類・プロファイル削除を確認します。Chromeは起動しません。
私有データのチェックサム照合は、明示的に `KZ_WORLD_DIR` を指定した場合だけ実行します。

## ブラウザとCIでの確認は別に残る

実装した環境（Codex）は `listen EPERM` で Chrome を起動できないため、実Chromeでの確認は親が行った（2026-11-09・手元の macOS の Chrome・ソフトウェア描画）：通常＝PASS（3画角・78秒・エラー0）・`--inject-bad-glsl`＝FAIL（6秒で検出・終了コード1）。Linux の CI での時間は、実際の PR で確かめる。
既存のrenderer公開口がないため、プログラムの種類と `diagnostics` の直接検査は未実装です。
画質・実機性能・非公開データの正しさは、この検査の対象外です。
ジョブには14分、スモークの通常の実行には 5.5 分（GitHub の共有 runner で 99 秒〜202 秒かかった）・壊れた GLSL の実行には 2 分の上限を設けます。
実行時間の達成と実PRの成功は、CIで確認してください。
mainの保護は [設定手順](../docs/CI_BRANCH_PROTECTION_JA.md) に従い、3回連続成功後に親が有効にします。
