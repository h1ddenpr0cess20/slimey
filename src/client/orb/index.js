/**
 * The slime orb, as a controller.
 *
 * Everything visual lives under this directory; nothing in it knows where its
 * input comes from. The controller surface is deliberately audio-shaped so a
 * voice pipeline drops in without touching the geometry:
 *
 *   orb.setState('speaking')   idle | listening | thinking | speaking
 *   orb.setLevel(0.62)         sustained amplitude 0..1 — mic RMS, or a TTS
 *                              AnalyserNode, sampled per frame
 *   orb.pulse(0.4)             transient impulse 0..1 — a token arriving now, or
 *                              a phoneme onset later
 *
 * The text path drives `pulse` because tokens are discrete. Audio drives
 * `setLevel` because waveforms are continuous. Both land on the same internal
 * `energy` value, so the orb deforms identically either way — swapping
 * transports is a change of caller, not of code in here.
 */

import { createDeformer } from './deform.js';
import { buildEnvironment } from './environment.js';
import { createLobes } from './lobes.js';
import { ENERGY_GAIN, MODES } from './modes.js';
import { createPalette } from './palette.js';
import { createBubbles, createCore, createGlow, createShell } from './parts.js';

export function createSlimeOrb({ stage, THREE }) {
  buildEnvironment({ stage, THREE });

  const paletteAt = createPalette(THREE);
  const deform = createDeformer(THREE);
  const lobes = createLobes(THREE);
  // The core rides the first three lobes only — the finer ones would be lost
  // inside a sphere half the radius.
  const coreLobes = lobes.slice(0, 3);

  const shell = createShell(THREE);
  const core = createCore(THREE);
  const glow = createGlow(THREE, shell.geometry);
  const bubbles = createBubbles(THREE);

  const orb = new THREE.Group();
  orb.name = 'slime_orb';
  orb.add(shell.mesh, core.mesh, glow.mesh, ...bubbles.meshes);

  let mode = MODES.idle;
  let state = 'idle';
  const m = { ...MODES.idle };

  /* `energy` is the animated value the surface actually reads. `sustain` is
     where it settles (continuous audio level); `impulse` is what decays on top
     of it (discrete token arrivals). A voice pipeline drives sustain and leaves
     impulse at zero; the text pipeline does the reverse. */
  let sustain = 0;
  let impulse = 0;
  let energy = 0;

  const tmpColor = new THREE.Color();
  const white = new THREE.Color('#ffffff');
  let hue = 0;
  let phase = 0;
  const timer = new THREE.Timer();

  shell.mesh.onBeforeRender = () => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);

    // Impulses fade fast enough to read as individual events; energy chases the
    // sum so the surface never steps discontinuously.
    impulse = Math.max(0, impulse - impulse * Math.min(1, dt * 3.4) - dt * 0.05);
    energy += (Math.min(1, sustain + impulse) - energy) * Math.min(1, dt * 6);

    for (const k in m) m[k] += (mode[k] - m[k]) * Math.min(1, dt * 3.2);

    const wobble = m.wobble * (1 + energy * ENERGY_GAIN.wobble);
    const speed = m.speed + energy * ENERGY_GAIN.speed;
    const halo = m.halo + energy * ENERGY_GAIN.halo;
    const bub = m.bub + energy * ENERGY_GAIN.bub;

    phase += dt * speed;
    hue += dt * m.hue;

    deform(shell.geometry, shell.base, lobes, {
      wobble,
      phase,
      scale: 1 + Math.sin(phase * 1.5) * m.breathe,
      ampScale: 1,
      freqScale: 2.35,
      phaseScale: 2.2,
    });

    deform(core.geometry, core.base, coreLobes, {
      wobble,
      phase,
      // The core swells with energy — it reads as the voice, the shell as the body.
      scale: 1 + energy * 0.16,
      ampScale: 1.5,
      freqScale: 2.6,
      phaseScale: -3,
    });

    paletteAt(hue, tmpColor);
    shell.material.color.copy(tmpColor);
    shell.material.attenuationColor.copy(tmpColor).lerp(white, 0.35);
    core.material.emissive.copy(tmpColor);
    core.material.emissiveIntensity = m.glow + energy * ENERGY_GAIN.glow;
    glow.material.uniforms.uColor.value.copy(tmpColor);
    glow.material.uniforms.uStrength.value = halo * 6.0 * (0.85 + Math.sin(phase * 2.1) * 0.15);

    core.mesh.position.set(
      Math.sin(phase * 0.7) * 0.06,
      Math.sin(phase * 0.9) * 0.05,
      Math.cos(phase * 0.6) * 0.06,
    );
    core.mesh.rotation.y = phase * 0.3;
    orb.rotation.y += dt * m.spin;

    for (const b of bubbles.meshes) {
      const o = b.userData.orbit;
      const a = o.a + phase * o.sp * bub;
      b.position.set(Math.cos(a) * o.rr, o.y + Math.sin(phase * 0.8 + o.a) * 0.12, Math.sin(a) * o.rr);
    }
  };

  stage.setObject(orb);

  // setObject() turns shadows on for every mesh it traverses, so these have to
  // come after it. The glow is additive and the bubbles live inside the shell —
  // neither has any business casting.
  glow.mesh.castShadow = glow.mesh.receiveShadow = false;
  for (const b of bubbles.meshes) b.castShadow = b.receiveShadow = false;

  return {
    get state() { return state; },

    /** idle | listening | thinking | speaking. Unknown names are ignored —
     *  hasOwn, not a truth test: `MODES.constructor` is truthy and NaNs every channel. */
    setState(next) {
      if (!Object.hasOwn(MODES, next) || next === state) return;
      state = next;
      mode = MODES[next];
      if (next === 'idle' || next === 'thinking') sustain = 0;
    },

    /** Sustained amplitude, 0..1. Call per frame from an AnalyserNode. */
    setLevel(level) {
      sustain = Math.min(1, Math.max(0, level));
    },

    /** Transient impulse, 0..1. Call once per discrete event (a token, an onset). */
    pulse(weight = 0.3) {
      impulse = Math.min(1, impulse + Math.min(1, Math.max(0, weight)));
    },
  };
}
