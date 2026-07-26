/** Deformation, colour drift and motion per conversational state. */
export const MODES = {
  idle:      { wobble: 1.15, speed: 1.0, hue: 0.055, breathe: 0.035, spin: 0.10, glow: 3.4, halo: 0.12, bub: 1 },
  listening: { wobble: 0.55, speed: 1.5, hue: 0.02,  breathe: 0.075, spin: 0.05, glow: 4.6, halo: 0.18, bub: 1.6 },
  thinking:  { wobble: 1.6,  speed: 2.4, hue: 0.34,  breathe: 0.02,  spin: 0.55, glow: 4.0, halo: 0.15, bub: 2.6 },
  speaking:  { wobble: 1.4,  speed: 3.4, hue: 0.13,  breathe: 0.10,  spin: 0.16, glow: 5.4, halo: 0.22, bub: 2 },
};

/** How far energy pushes each channel past its state baseline at full level. */
export const ENERGY_GAIN = { wobble: 0.55, speed: 1.4, glow: 1.8, halo: 0.10, bub: 1.2 };
