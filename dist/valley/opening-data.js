// opening-data.js — オープニング（語りと絵のような場面）のデータ（data層）。語り・時間割・題名・字の色。
// 語りの文は design-opening.md §2 の案（本人の確認前）。文は誤字以外は変えない。声を後から足せるよう、画面ごとに id を持つ（R22.2）。
// 史実の画面は生成り、創作の画面は朱の字にして、創作と分かる形で出す（R19.4）。時刻はすべて秒。数値は未測定の設計目標。
const freeze = o => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };

export const OPENING = freeze({
  lines: {
    op_n1: { text: '元弘三年五月。鎌倉に、火が上がった。', kind: 'history' },
    op_n2: { text: 'およそ百五十年続いた幕府は、数日の攻防の末に滅んだ。', kind: 'history' },
    op_n3: { text: '東勝寺は焼け、北条一門は、そこで自害した。', kind: 'history' },
    op_n4: { text: '主を失った者たちは、散り散りに山へ向かった。', kind: 'fiction' },
    op_n5: { text: '榊三郎景継も、その一人。あの夜のことを、誰にも語らなかった。', kind: 'fiction' },
    op_n6: { text: '——その火は、まだ消えていなかった。', kind: 'fiction' },
  },
  title: { text: '残火の鎌倉', note: 'この物語の人物と谷は、創作です。' },
  // 字は帯（bar）の上に置く。帯は不透明なので、字と帯の比がそのまま読みやすさの比になる（4.5:1以上。試験で測る）
  colors: { history: '#eee9dc', fiction: '#e36b48', title: '#eee9dc', note: '#b6b9ac', hint: '#9aa196', bar: '#05080a' },
  // 区間は [id, 始まり, 終わり]、語りは [id, 出す, 消す]。dark=暗転、A〜D=場面、title=題名、wake=既存の目覚め（最後の区間）
  versions: {
    full: {
      segments: [['dark', 0, 2], ['A', 2, 11.5], ['B', 11.5, 21], ['C', 21, 30.5], ['D', 30.5, 42], ['title', 42, 47], ['wake', 47, 52.2]],
      lines: [['op_n1', 2, 6], ['op_n2', 6, 11], ['op_n3', 12, 16.5], ['op_n4', 21.5, 26], ['op_n5', 31, 37], ['op_n6', 38, 42]],
    },
    // 2回目以降の「はじめから」。目覚めは既存の時間割（5.2秒）を変えないので、合計は約15.7秒
    short: {
      segments: [['dark', 0, 1], ['A', 1, 4.5], ['D', 4.5, 8], ['title', 8, 10.5], ['wake', 10.5, 15.7]],
      lines: [['op_n1', 1.2, 4.5], ['op_n6', 4.7, 8]],
    },
  },
  wake: { getupAt: 2.7, skipAfter: 0.6 },   // 既存の目覚め：2.7秒で立ち上がる。0.6秒を過ぎたら飛ばせる
  skip: { lockout: 0.6, fade: 0.6 },        // 開始から0.6秒は飛ばせない。飛ばしたら0.6秒で暗転して目覚めへ
  fade: { fromDark: 1.2, toTitle: 1.0, dissolve: 1.0, line: 0.45, titleDelay: 0.3, titleIn: 1.0, titleOut: 0.8, hint: 0.5 },
  // 場面ごとのカメラの鍵。still は「動きを減らす」で止めるときの位置（0〜1）
  shots: { A: { still: 0.5 }, B: { still: 0.5 }, C: { still: 0.5 }, D: { still: 0.55 } },
});
