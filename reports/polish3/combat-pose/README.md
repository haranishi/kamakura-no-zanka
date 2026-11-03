# 8.3b 被弾・弾かれ・倒れの姿勢と、弾いた瞬間の案内：前後の記録

8.4a・8.5a の盲検で姿勢（K5）が2周とも4点だった件のうち、見た目だけで直せる3つを扱った（2026-11-03）。
設計・捨てた案は `.kiro/specs/hidden-valley-slice/design-combat-pose.md`。ここは測った結果と画像の置き場で、点数は付けていない。

## 画像（`before-*.jpg`・`after-*.jpg`）

変更前（main の `fc3a914`）と変更後を、`capture-combat-impact.mjs` の同じ固定カメラ（2人を真横から）・seed 1333・同じ入力で撮った。1枚12コマ。

| 場面 | 見どころ（変更後） |
| --- | --- |
| A 通常三連 | コマ64（三段目の当たりの直後）で、相手の両手が顔の前でなく胸の高さ。一段目の停止のコマで、相手の構えの腕が下がり刀が下を向く |
| D 弾き | コマ33〜43で、弾かれた相手の腕が前へ伸びたままでなく下がる。上の案内は弾きの説明のままで「とどめ」が出ない |
| F とどめ | コマ30〜64で、倒れる相手の腕が前・横へ突き出さず、体の脇へ下がる |

撮り方：`KZ_TAG=after PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-combat-impact.mjs --seed 1333 --out <フォルダ>`。変更前は main を `git archive` で書き出した写しで同じ道具を使った。

## 腕の開き（`arm-spread.json`）

`tools/scenarios/measure-arm-spread.mjs`。斥候の模型に動作を当て、腕全体（肩→手首）と胴の下向き（首→腰）のなす角を毎コマ測った（off＝層なし、on＝層あり）。

| 動作 | off の最大（左／右） | off で60度を越えたコマ | on の最大 |
| --- | ---: | ---: | ---: |
| dying_backwards | 108／107度 | 226 | 40度 |
| dying | 93／111度 | 5 | 40度 |
| 膝からの dying_backwards・dying | 109／111度・92／112度 | 215・5 | 40度 |
| Hit_Reaction_1 | 108／110度 | 67 | 50度 |
| Hit_Reaction_to_Waist | 104／113度 | 85 | 55度 |

## 案内（`regress-combat-hints.mjs`）

弾いたあとの42コマのうち「とどめ」の案内が出たコマ：変更前の main 42、変更後 0。崩れた敵の前では、前後とも「とどめを刺す」の表示と案内が出る。

## 論理・性能・回帰

- 論理（`regress-attack-timing.mjs`）：斥候320コマ・侍大将520コマとも main と一致。
- 性能：新しい形・材質はなく、描画呼出の増加は0。毎コマの確保は純粋な部分で0.64B/コマ（何もしない繰り返し0.56B）。結線のブラウザでの確保は測っていない。
- 試験6件（`tests/valley-arm-spread.test.mjs`）、変異20件すべて検出（`tools/verify-arm-spread-mutations.mjs`）。
- 回帰の全本（`--strict`）：22本すべて合格（新しい `regress-combat-hints` を含む。`regress-lunge`・`regress-hand-grip-game`・`regress-hand-grip`・`regress-impact`・`regress-slash-trail` も合格）。

## 自分の目で見た所見（採点ではない）

倒れと三段目の腕の跳ね上がりは、真横のカメラで見て分かる程度に変わった。弾かれの終わり（D のコマ58）に刀が頭上へ上がる形は手首のひねりで、変わらない。
鎧でひるまない一・二発目と弾かれでは、当たった停止の最初のコマで構えの腕が約35度下がる。「構えが崩れた」と読めるが、刀の位置が1コマで変わる。

## 未確認

- 本人のプレイと、別役の盲検採点
- Safari・Firefox・実機、主人公の後ろからの通常のカメラでの見え方
