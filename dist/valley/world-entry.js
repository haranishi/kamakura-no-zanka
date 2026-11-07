// Keep the original boot and all private requests behind an explicit opt-in.
export const wantsKamakura = search => new URLSearchParams(search).get('world') === 'kamakura';
export async function startWorld(search, { valley, kamakura, fallback }) {
  if (!wantsKamakura(search)) return valley();
  try { return await kamakura(); }
  catch { fallback(); return valley(); }
}

export function verticalScale(search) {
  const value = Number(new URLSearchParams(search).get('vscale') ?? 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}
