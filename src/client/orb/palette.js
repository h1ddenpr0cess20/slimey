/** The palette the orb drifts through, sampled at a continuous position. */

const STOPS = ['#38f2b6', '#37c8f7', '#8f7bff', '#ff62c8', '#ffc861'];

export function createPalette(THREE) {
  const colors = STOPS.map((h) => new THREE.Color(h));

  /** Wraps, so `t` can run forever without wrapping bookkeeping at the caller. */
  return function paletteAt(t, out) {
    const f = ((t % colors.length) + colors.length) % colors.length;
    const i = Math.floor(f);
    return out.copy(colors[i]).lerp(colors[(i + 1) % colors.length], f - i);
  };
}
