# 第3弾・タスク8.0の静的な前測定

Node.js 18以上で実行する。ブラウザ・追加依存・ビルド・外部通信は不要。
ゲームのコードや規則は変更しない。リポジトリ直下で次を使う。

```sh
node tools/measure-move-segments.mjs
node tools/measure-move-segments.mjs --json
node tools/measure-move-segments.mjs --write reports/polish3/baseline/move-segments-before.json
node tools/measure-clip-provenance.mjs
node tools/measure-clip-provenance.mjs --json
node tools/measure-clip-provenance.mjs --write reports/polish3/baseline/clip-provenance-before.json
node --test tests/polish3-move-segments.test.mjs
```

引数なしはMarkdown表、`--json`はJSONを標準出力へ出す。
`--write <path>`は親ディレクトリを作り、同じJSONを保存する（標準出力は空）。
不正な引数は終了コード2、入力欠落・書込失敗などは1。正常時は0。
既存の保存先を指定すると上書きするので、比較後の値は別名へ保存する。

## 技の使用区間

`MOVES`の時間割と`MOVE_CLIPS`の表示用対応を、現行の`segmentFor`へ渡す。
弓兵・味方射撃を含む全13技を、対応表の定義順で記録する。

| JSONの項目 | 読み方 |
| --- | --- |
| id / clip | 技ID / 表示に使う元動作名（combat.jsのclip名とは異なる技がある） |
| clipSeconds / moveSeconds | 元動作の秒 / windup＋active＋recoverの秒 |
| from / to / usedSeconds | 元動作上の開始・終了秒 / 丸め前のto−from |
| speed / ratio | 基準倍率 / 丸め前の使用秒÷元動作秒（0〜1） |
| approximate / fixedSegment | segmentForの概算フラグ / CLIP_SEGMENTSの決め打ちを使用したか |
| effectiveSpeedMin/Max | 個体倍率を掛けた理論上の最小・最大倍率 |
| meetsTarget / exceptions | 初期目標の成否 / 不足理由（ratio・speed、両方なら2項目） |

秒と倍率は小数2桁、ratioは3桁に丸める。JSONの数値では末尾の0は省略される。
内部の計算と目標判定は丸め前に行うので、表示したfrom/toの差と使用秒には丸め差がある。
初期目標は使用割合0.60以上かつ基準倍率1.8以下。自然さの合格認定ではない。
実効倍率は別欄で比較する。敵の個体差はactors.jsの式から0.94〜1.06倍と確認した。
characters.jsでrateの適用も確認し、主人公と味方は1倍とする。
計測時に式・適用経路を確認できなければ実効倍率はnull、理由はnotesへ残す。
個体差の幅は配置済みの敵の標本最小・最大ではない。

## 動作の出所

clips.jsonの全動作を名前順に棚卸しし、CMU_で始まる3本とそれ以外66本を分類する。
`basis`にNOTICE.mdに基づく説明、末尾の`counts`にカテゴリ別の本数を記録する。
CMU節は商品同梱可・単体転売不可を示し、Meshy節は動き単体の再配布条件を未確認としている。
全件のstatusはunconfirmed。個別の取得元を示す台帳がないため推測で補わない。
この分類だけで個々の動作の出所・再配布許諾を確認済みとはしない。

## 保存済みの前値と対象外

前値は上記の`reports/polish3/baseline/*-before.json`。時刻や環境を含まず、同じ入力なら同じバイト列になる。
テストはresearch-polish3.mdの表との照合、決定性、保存値との一致、終了コードなどを確認する。
更新後も前値を残し、別のJSONを同じ道具で作って比較する。

予備・振り・残心の3区間の有無、足滑り、接触の自然さは未測定。
これらには画像とブラウザでの確認が要る。動画の盲検採点・本人のプレイも本ツールの対象外。
実プレイの割り込み・動作の混合・停止・入力同期・抜刀納刀・性能・容量は測っていない。
闇討ちはactors.jsのtryInteractがfinisherへ別の時間割を渡すため、その区間も対象外。
今回はNodeの静的計測のみで、タスク8.0全体の完了を示すものではない。
