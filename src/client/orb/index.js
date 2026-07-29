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

  glow.mesh.castShadow = glow.mesh.receiveShadow = false;
  for (const b of bubbles.meshes) b.castShadow = b.receiveShadow = false;

  return {
    get state() { return state; },

    setState(next) {
      if (!Object.hasOwn(MODES, next) || next === state) return;
      state = next;
      mode = MODES[next];
      if (next === 'idle' || next === 'thinking') sustain = 0;
    },

    setLevel(level) {
      sustain = Math.min(1, Math.max(0, level));
    },

    pulse(weight = 0.3) {
      impulse = Math.min(1, impulse + Math.min(1, Math.max(0, weight)));
    },
  };
}
