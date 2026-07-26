/**
 * The slime orb, as a controller.
 *
 * Everything visual lives here; nothing in this file knows where its input comes
 * from. The controller surface is deliberately audio-shaped so a voice pipeline
 * drops in without touching the geometry:
 *
 *   orb.setState('speaking')   idle | listening | thinking | speaking
 *   orb.setLevel(0.62)         sustained amplitude 0..1 — mic RMS, or a TTS
 *                              AnalyserNode, sampled per frame
 *   orb.pulse(0.4)             transient impulse 0..1 — a token arriving now, or
 *                              a phoneme onset later
 *
 * The text path drives `pulse` because tokens are discrete. Audio drives
 * `setLevel` because waveforms are continuous. Both land on the same internal
 * `energy` value, so the orb deforms identically either way — swapping transports
 * is a change of caller, not of code in here.
 */

/** Deformation, colour drift and motion per conversational state. */
const MODES = {
  idle:      { wobble: 1.15, speed: 1.0, hue: 0.055, breathe: 0.035, spin: 0.10, glow: 3.4, halo: 0.12, bub: 1 },
  listening: { wobble: 0.55, speed: 1.5, hue: 0.02,  breathe: 0.075, spin: 0.05, glow: 4.6, halo: 0.18, bub: 1.6 },
  thinking:  { wobble: 1.6,  speed: 2.4, hue: 0.34,  breathe: 0.02,  spin: 0.55, glow: 4.0, halo: 0.15, bub: 2.6 },
  speaking:  { wobble: 1.4,  speed: 3.4, hue: 0.13,  breathe: 0.10,  spin: 0.16, glow: 5.4, halo: 0.22, bub: 2 },
};

/** How far energy pushes each channel past its state baseline at full level. */
const ENERGY_GAIN = { wobble: 0.55, speed: 1.4, glow: 1.8, halo: 0.10, bub: 1.2 };

export function createSlimeOrb({ stage, THREE }) {
  buildEnvironment({ stage, THREE });

  const orb = new THREE.Group();
  orb.name = 'slime_orb';

  /* palette the orb drifts through */
  const PALETTE = ['#38f2b6', '#37c8f7', '#8f7bff', '#ff62c8', '#ffc861'].map((h) => new THREE.Color(h));
  const paletteAt = (t, out) => {
    const f = ((t % PALETTE.length) + PALETTE.length) % PALETTE.length;
    const i = Math.floor(f);
    return out.copy(PALETTE[i]).lerp(PALETTE[(i + 1) % PALETTE.length], f - i);
  };

  /* smooth organic displacement: sum of directional sines (cheap, seamless) */
  const LOBES = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 2.399963, r = Math.sqrt(1 - Math.pow(1 - 2 * (i + 0.5) / 5, 2));
    LOBES.push({
      dir: new THREE.Vector3(Math.cos(a) * r, 1 - 2 * (i + 0.5) / 5, Math.sin(a) * r).normalize(),
      freq: 1.0 + i * 0.42,
      speed: 0.45 + i * 0.19,
      amp: 0.115 / (1 + i * 0.6),
      phase: i * 1.7,
    });
  }

  const shellMat = new THREE.MeshPhysicalMaterial({
    name: 'slime_shell',
    color: new THREE.Color('#38f2b6'),
    transparent: true,
    opacity: 0.78,
    transmission: 0.9,
    thickness: 0.35,
    ior: 1.3,
    roughness: 0.08,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    iridescence: 0.35,
    iridescenceIOR: 1.35,
    attenuationDistance: 2.4,
    attenuationColor: new THREE.Color('#7ff0d8'),
    sheen: 0.5,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color('#ffffff'),
  });
  const shellGeo = new THREE.SphereGeometry(1, 128, 80);
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.name = 'shell';
  orb.add(shell);
  const basePos = shellGeo.attributes.position.array.slice();

  const coreMat = new THREE.MeshStandardMaterial({
    name: 'slime_core',
    color: new THREE.Color('#0d2a2c'),
    emissive: new THREE.Color('#38f2b6'),
    emissiveIntensity: 3.5,
    roughness: 0.35,
    metalness: 0,
    transparent: true,
    opacity: 0.95,
  });
  const coreGeo = new THREE.SphereGeometry(0.5, 64, 42);
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.name = 'core';
  orb.add(core);
  const coreBase = coreGeo.attributes.position.array.slice();

  /* glow bound to the shell's own geometry — a rim bloom, not a second sphere */
  const glowMat = new THREE.ShaderMaterial({
    name: 'slime_glow',
    uniforms: { uColor: { value: new THREE.Color('#38f2b6') }, uStrength: { value: 0.5 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vP;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position * 1.035, 1.0);
        vP = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uStrength;
      varying vec3 vN; varying vec3 vP;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(-vP)));
        float a = pow(f, 2.2) * (1.0 - pow(f, 8.0)) * uStrength;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(shellGeo, glowMat);
  glow.name = 'glow';
  orb.add(glow);

  /* suspended bubbles inside the goo */
  const bubbleMat = new THREE.MeshPhysicalMaterial({
    name: 'slime_bubble',
    color: new THREE.Color('#eafffb'),
    roughness: 0.05,
    metalness: 0,
    transmission: 0.95,
    thickness: 0.15,
    ior: 1.2,
    transparent: true,
    opacity: 0.5,
  });
  const bubbles = [];
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.045 + (i % 3) * 0.028, 20, 14), bubbleMat);
    b.name = 'bubble_' + (i + 1);
    const a = i * 2.399963, rr = 0.42 + (i % 4) * 0.11;
    b.userData.orbit = { a, rr, y: -0.4 + i * 0.13, sp: 0.25 + (i % 3) * 0.14 };
    bubbles.push(b);
    orb.add(b);
  }

  let mode = MODES.idle;
  let state = 'idle';
  const m = { ...MODES.idle };

  /* `energy` is the animated value the surface actually reads. `sustain` is where
     it settles (continuous audio level); `impulse` is what decays on top of it
     (discrete token arrivals). A voice pipeline drives sustain and leaves impulse
     at zero; the text pipeline does the reverse. */
  let sustain = 0;
  let impulse = 0;
  let energy = 0;

  const v = new THREE.Vector3();
  const tmpColor = new THREE.Color();
  const white = new THREE.Color('#ffffff');
  let hue = 0, phase = 0;
  const clock = new THREE.Clock();

  shell.onBeforeRender = () => {
    const dt = Math.min(clock.getDelta(), 0.05);

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

    const pos = shellGeo.attributes.position;
    const arr = pos.array;
    const breathe = 1 + Math.sin(phase * 1.5) * m.breathe;
    for (let i = 0; i < arr.length; i += 3) {
      v.set(basePos[i], basePos[i + 1], basePos[i + 2]);
      let d = 0;
      for (const l of LOBES) {
        d += l.amp * Math.sin(l.freq * v.dot(l.dir) * 2.35 + phase * l.speed * 2.2 + l.phase);
      }
      const s = (1 + d * wobble) * breathe;
      arr[i] = v.x * s; arr[i + 1] = v.y * s; arr[i + 2] = v.z * s;
    }
    pos.needsUpdate = true;
    shellGeo.computeVertexNormals();

    const cpos = coreGeo.attributes.position, ca = cpos.array;
    // The core swells with energy — it reads as the voice, the shell as the body.
    const coreScale = 1 + energy * 0.16;
    for (let i = 0; i < ca.length; i += 3) {
      v.set(coreBase[i], coreBase[i + 1], coreBase[i + 2]);
      let d = 0;
      for (let j = 0; j < 3; j++) {
        const l = LOBES[j];
        d += l.amp * 1.5 * Math.sin(l.freq * v.dot(l.dir) * 2.6 - phase * l.speed * 3 + l.phase);
      }
      const s = (1 + d * wobble) * coreScale;
      ca[i] = v.x * s; ca[i + 1] = v.y * s; ca[i + 2] = v.z * s;
    }
    cpos.needsUpdate = true;
    coreGeo.computeVertexNormals();

    paletteAt(hue, tmpColor);
    shellMat.color.copy(tmpColor);
    shellMat.attenuationColor.copy(tmpColor).lerp(white, 0.35);
    coreMat.emissive.copy(tmpColor);
    coreMat.emissiveIntensity = m.glow + energy * ENERGY_GAIN.glow;
    glowMat.uniforms.uColor.value.copy(tmpColor);
    glowMat.uniforms.uStrength.value = halo * 6.0 * (0.85 + Math.sin(phase * 2.1) * 0.15);

    core.position.set(Math.sin(phase * 0.7) * 0.06, Math.sin(phase * 0.9) * 0.05, Math.cos(phase * 0.6) * 0.06);
    core.rotation.y = phase * 0.3;
    orb.rotation.y += dt * m.spin;

    for (const b of bubbles) {
      const o = b.userData.orbit, a = o.a + phase * o.sp * bub;
      b.position.set(Math.cos(a) * o.rr, o.y + Math.sin(phase * 0.8 + o.a) * 0.12, Math.sin(a) * o.rr);
    }
  };

  stage.setObject(orb);
  glow.castShadow = false; glow.receiveShadow = false;
  bubbles.forEach((b) => { b.castShadow = false; b.receiveShadow = false; });

  return {
    get state() { return state; },

    /** idle | listening | thinking | speaking. Unknown names are ignored. */
    setState(next) {
      if (!MODES[next] || next === state) return;
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

/* Soft studio environment so the transmissive shell has something to refract;
   PMREM keeps roughness blur physically sane. A nicety, not a requirement. */
function buildEnvironment({ stage, THREE }) {
  try {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, '#dfe6ff'); g.addColorStop(0.45, '#8f9bb8');
    g.addColorStop(0.5, '#3a4152'); g.addColorStop(1, '#0d0f15');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 32);
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath();
    ctx.ellipse(20, 8, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(160,210,255,0.8)'; ctx.beginPath();
    ctx.ellipse(48, 12, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
    const tex = new THREE.Texture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const pmrem = new THREE.PMREMGenerator(stage._renderer);
    stage._scene.environment = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose(); tex.dispose();
  } catch (e) { /* environment is a nicety, not a requirement */ }
}
