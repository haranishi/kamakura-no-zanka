# 戦いの金属音（2026-11-03）

判断と狙いは `.kiro/specs/hidden-valley-slice/design-audio-combat.md`。ここは証拠だけ。

- `spectrogram-before.jpg`／`spectrogram-after.jpg`：1発ずつの時間×周波数（0〜1.6秒・0〜12kHz）。前の版に無い種類は「後」だけにある。
- `sounds-before.json`／`sounds-after.json`：ピーク・RMS・重心・余韻（−40dBまで）。`tools/scenarios/capture-combat-sounds.mjs` で書き出した（圧縮器とリミッターを通さない素通し）。
- `regress-combat-sounds.txt`：`regress-combat-sounds.mjs` の出力（種8つ×10種）。
- 試聴用のWAVは容量のためリポジトリに入れない。同じ道具で前後のコミットから書き出せる。
