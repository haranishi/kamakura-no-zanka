# アセット・依存ライブラリ・取り扱い

## 同梱されるもの

- v16の実行コードとHTML/CSS。
- v14の実3Dシーンから作った最適化済み `scene.glb`。画像はGLB内部に含み、実行に外部素材配信は不要。
- 元の地面から採取した高さと家・井戸等の簡易衝突データ。
- Three.js **0.180.0**、GLTFLoader、BufferGeometryUtils。ライセンスはMIT、全文を `licenses/THREE-LICENSE.txt` および `dist/vendor/THREE-LICENSE.txt` に同梱。
- ブラウザ版で使う38画像は最大1024px。稲901株、GPUインスタンス33グループ。GLBは19,476,020 bytes。
- 参考のエクスポートスクリプトと素材出典記録。

Node.js標準ライブラリだけで起動・既存テスト・配布検査を実行できるため、npm依存はありません。PythonやBlenderは通常起動に不要です。外部フォントや他ゲームの絵・ロゴは使っていません。音声素材はまだありません。

## ライセンスは3つに分かれる

- コード：MIT（`LICENSE`）。
- 3Dモデル・動き・画像・物語：CC BY 4.0（`LICENSE-ASSETS.md`）。
- Three.js、Poly Haven、CMU のモーションなどの第三者の物：それぞれの条件（`NOTICE.md`）。

Three.js の MIT を、プロジェクト全体や素材のライセンスとみなさないでください。逆に、素材の CC BY をコードへ広げることもしません。新しい素材を足すときは、どれに当たるかを決めて `NOTICE.md` と `provenance/` に残します。

以下は、元の制作に使った Poly Haven 素材の出典です。Poly Haven は全素材を CC0 1.0 で提供しています。

- ライセンス説明：https://polyhaven.com/license
- https://polyhaven.com/a/forest_ground_05
- https://polyhaven.com/a/rock_moss_set_02
- https://polyhaven.com/a/fern_02
- https://polyhaven.com/a/xanderklinge
- https://polyhaven.com/a/weathered_planks
- https://polyhaven.com/a/thatch_roof_angled
- https://polyhaven.com/a/fir_tree_01
- https://polyhaven.com/a/grass_medium_01

`provenance/` に元の素材名、出典URL、ハッシュ等の記録を収録しています。実行環境の絶対パスと作業用ファイル識別子は除外しました。出典に載る素材の全原本を同梱しているわけではありません。独自の地形・建築・配置と、元スキャン素材の作者を区別してください。

井戸や小道具などプロジェクト内素材の出所は `provenance/v14_source_manifest.json` も参照。出所の記録だけで再配布ライセンスを推定しないでください。

## 元の編集用Blenderデータ

大きな原本・制作途中データはこのリポジトリに含めていません（公開していません）。ブラウザ開発は同梱GLBだけで始められます。元の .blend が無いと、地形や家の形そのものは作り直せません。同梱GLBの上で、配置や質感を直す作業は可能です。

元v14 .blendの記録用SHA256：`69085ce63282b8719f575d023f57f7bd6f727fa360284a7cbb16f9b8f1e13d2f`。

## 参考エクスポートについての重要な注意

`tools/export_scene_reference.py` は制作時のBlenderエクスポート処理です。通常起動に実行してはいけません。

- 別途Blender 4.5系と元v14 .blendが必要です。元の .blend は公開していないので、外部の方は実行できません。
- 環境変数 `KAMAKURA_V14_BLEND` に自分の環境の原本パスを渡します。デフォルトの兄弟フォルダ構成はこのリポジトリに含まれません。
- **実行するとこのフォルダの `dist/assets/` を上書きします。必ず別の作業コピーで実行してください。** 原本.blend自体は保存し直しません。
- 同梱の最終GLBは、制作時に稲画像を線形→sRGBへ補正したものです。その記録は `provenance/rice_color_fix.json`。参考スクリプトにも現在はその変換処理が入っているので、補正を無条件に二重適用しないでください。ただし、この版のスクリプトによる最終GLBの完全な再現は今回検証していません。再書き出し後は色・形状を現行GLBと比較する必要があります。
- この引き継ぎ作成時には再エクスポートを実行していません。**完成済みの同梱GLBを基準**にしてください。

## 含めていないもの

認証情報、セッショントークン、秘密鍵、個人データ、制作環境の調査ログ、キャッシュ、node_modules、元の巨大Blenderアーカイブ。
