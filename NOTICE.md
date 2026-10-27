# 第三者の素材と謝辞

このリポジトリのライセンスは、コードが MIT（[LICENSE](LICENSE)）、素材と物語が CC BY 4.0（[LICENSE-ASSETS.md](LICENSE-ASSETS.md)）。
次の物は、それぞれの条件に従います。出所の記録は `provenance/` にあります。

## 同梱しているライブラリ・ひな形

| 物 | 条件 | 置き場所 |
|---|---|---|
| Three.js 0.180.0（本体・GLTFLoader・BufferGeometryUtils・SkeletonUtils） | MIT | `dist/vendor/`、全文は `licenses/THREE-LICENSE.txt` |
| 仕様書のひな形（cc-sdd。https://github.com/gotalab/cc-sdd） | MIT | `.kiro/settings/templates/` |

## 画像（CC0）

地面・林床・枝葉・岩・板・茅などの画像と元の質感は [Poly Haven](https://polyhaven.com/license)（CC0 1.0）。表示は要りませんが、作者に感謝します。
dirt_floor は eye-candy.xyz、forest_leaves_02 は Rob Tuytel、fir_tree_01 は Rob Tuytel と Rico Cilliers。ファイルごとの取得元・容量・SHA256 は `provenance/terrain-v18.json` と `provenance/house_v08_*.json`。

## モーションキャプチャ（CMU）

走る・歩く動き（`CMU_Walk`・`CMU_Jog`・`CMU_Run`）は、Carnegie Mellon University の Graphics Lab Motion Capture Database を、Meshy の骨へ写し替えて人物モデルに焼いた物です。
CMU は、商品に含めてよい一方、データそのものを転売しないことと、謝辞を求めています。このリポジトリは元のデータを再配布していません。

> The data used in this project was obtained from mocap.cs.cmu.edu.
> The database was created with funding from NSF EIA-0196217.

## AI で生成した素材（Meshy）

人物7体・小道具14点と、動きの一部は Meshy（https://www.meshy.ai）で生成しました。2026-10-27 に、有料プランの API で作っています。
Meshy は、有料プランの利用者が生成物を所有できるとしています。条件は、Meshy のコミュニティへ公開しないことと、入力に他人の著作物を使わないことです。
タスクの識別子・設定・SHA256 は `provenance/meshy-v19.json` にあります。

## 作者の別作品から写した道具

`tools/blender/mz_*.py` と `build_valley_character.py` は、作者の別作品（非公開）の Blender 道具を写した物で、MIT です。
動きを写し替える元の動作キャッシュ（`KAMAKURA_MOTION_CACHE`）はこのリポジトリに含まれません。同梱の GLB から遊ぶだけなら要りません。

## 参考にしたもの

周回して磨く進め方と、固定画角で撮り比べる方法は、外部の参照プロジェクトを見て借りました。そのコード・数値・素材は含みません。
