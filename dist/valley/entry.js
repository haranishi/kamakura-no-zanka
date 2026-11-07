import { startWorld } from './world-entry.js';
await startWorld(location.search, {
  valley: () => import('./main.js'),
  kamakura: async () => {
    const { loadKamakura } = await import('./kamakura-data.js');
    const data = await loadKamakura();
    const { bootKamakura } = await import('./world-kamakura.js');
    await bootKamakura(data, location.search);
  },
  fallback: () => {
    const note = document.createElement('p'); note.setAttribute('role', 'alert');
    note.textContent = '鎌倉を読み込めませんでした。KZ_WORLD_DIRの設定とデータを確認してください。既存の谷へ戻りました。';
    Object.assign(note.style, { position: 'fixed', top: '0', left: '0', right: '0', zIndex: '1000', margin: '0', padding: '12px', background: '#fff4d5', color: '#30281c', pointerEvents: 'none' });
    document.body.append(note);
  }
});
