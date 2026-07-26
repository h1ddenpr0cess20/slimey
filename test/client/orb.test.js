/**
 * The orb's pure maths. No WebGL — three's geometry and colour classes are
 * plain arithmetic and run fine in Node.
 *
 * The deform suite is the regression guard for the refactor that pulled one
 * deformer out of two near-identical inline loops: it reimplements the original
 * expressions verbatim and demands the shared kernel match them exactly.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';

import { createDeformer } from '../../src/client/orb/deform.js';
import { createLobes } from '../../src/client/orb/lobes.js';
import { ENERGY_GAIN, MODES } from '../../src/client/orb/modes.js';
import { createPalette } from '../../src/client/orb/palette.js';

describe('MODES', () => {
  const CHANNELS = ['wobble', 'speed', 'hue', 'breathe', 'spin', 'glow', 'halo', 'bub'];

  it('covers the four conversational states', () => {
    assert.deepEqual(Object.keys(MODES).sort(), ['idle', 'listening', 'speaking', 'thinking']);
  });

  it('gives every state every channel', () => {
    // The easing loop walks the keys of the idle mode and reads mode[k] off
    // whichever state is current. A channel missing from one state would ease
    // toward undefined and put NaN into the vertex positions — the orb vanishes.
    for (const [name, mode] of Object.entries(MODES)) {
      assert.deepEqual(Object.keys(mode).sort(), [...CHANNELS].sort(), `${name} is missing a channel`);
      for (const [channel, value] of Object.entries(mode)) {
        assert.equal(typeof value, 'number', `${name}.${channel}`);
        assert.ok(Number.isFinite(value), `${name}.${channel} is not finite`);
      }
    }
  });

  it('names only channels that exist when energy pushes them', () => {
    for (const channel of Object.keys(ENERGY_GAIN)) {
      assert.ok(channel in MODES.idle, `ENERGY_GAIN.${channel} has no matching mode channel`);
    }
  });

  it('keeps listening calmer than speaking, which is the whole read', () => {
    assert.ok(MODES.listening.wobble < MODES.speaking.wobble);
    assert.ok(MODES.listening.speed < MODES.speaking.speed);
    assert.ok(MODES.thinking.spin > MODES.listening.spin);
  });
});

describe('createLobes', () => {
  it('produces unit directions, so dot products stay in -1..1', () => {
    for (const lobe of createLobes(THREE)) {
      assert.ok(Math.abs(lobe.dir.length() - 1) < 1e-12);
    }
  });

  it('gives each lobe a distinct frequency, so they never line up', () => {
    const freqs = createLobes(THREE).map((l) => l.freq);
    assert.equal(new Set(freqs).size, freqs.length);
  });

  it('shrinks amplitude as frequency rises, keeping the surface smooth', () => {
    const lobes = createLobes(THREE);
    for (let i = 1; i < lobes.length; i++) {
      assert.ok(lobes[i].amp < lobes[i - 1].amp);
      assert.ok(lobes[i].freq > lobes[i - 1].freq);
    }
  });

  it('is deterministic — no randomness to make the orb differ per load', () => {
    const a = createLobes(THREE);
    const b = createLobes(THREE);
    assert.deepEqual(
      a.map((l) => [l.dir.toArray(), l.freq, l.speed, l.amp, l.phase]),
      b.map((l) => [l.dir.toArray(), l.freq, l.speed, l.amp, l.phase]),
    );
  });

  it('honours a custom count', () => {
    assert.equal(createLobes(THREE, 3).length, 3);
  });
});

describe('createPalette', () => {
  const paletteAt = createPalette(THREE);
  const at = (t) => paletteAt(t, new THREE.Color()).getHexString();

  it('lands exactly on a stop at whole numbers', () => {
    assert.equal(at(0), '38f2b6');
    assert.equal(at(1), '37c8f7');
  });

  it('wraps, so hue can accumulate forever', () => {
    assert.equal(at(5), at(0));
    assert.equal(at(12.5), at(2.5));
  });

  it('handles a negative position without producing NaN', () => {
    // JS % keeps the sign of the dividend; the wrap has to correct for it.
    assert.equal(at(-1), at(4));
    assert.match(at(-0.5), /^[0-9a-f]{6}$/);
  });

  it('interpolates between neighbouring stops', () => {
    const mid = paletteAt(0.5, new THREE.Color());
    const a = paletteAt(0, new THREE.Color());
    const b = paletteAt(1, new THREE.Color());
    for (const ch of ['r', 'g', 'b']) {
      assert.ok(Math.abs(mid[ch] - (a[ch] + b[ch]) / 2) < 1e-6, `channel ${ch}`);
    }
  });

  it('closes the loop from the last stop back to the first', () => {
    const nearEnd = paletteAt(4.999, new THREE.Color());
    const start = paletteAt(0, new THREE.Color());
    for (const ch of ['r', 'g', 'b']) {
      assert.ok(Math.abs(nearEnd[ch] - start[ch]) < 0.01, `channel ${ch} jumps at the seam`);
    }
  });

  it('writes into the colour it is given instead of allocating per frame', () => {
    const out = new THREE.Color();
    assert.equal(paletteAt(1.5, out), out);
  });
});

describe('createDeformer', () => {
  const deform = createDeformer(THREE);
  const lobes = createLobes(THREE);

  /** The shell displacement exactly as it was written inline before the split. */
  function originalShell(base, wobble, phase, breathe) {
    const v = new THREE.Vector3();
    const arr = base.slice();
    for (let i = 0; i < arr.length; i += 3) {
      v.set(base[i], base[i + 1], base[i + 2]);
      let d = 0;
      for (const l of lobes) {
        d += l.amp * Math.sin(l.freq * v.dot(l.dir) * 2.35 + phase * l.speed * 2.2 + l.phase);
      }
      const s = (1 + d * wobble) * breathe;
      arr[i] = v.x * s; arr[i + 1] = v.y * s; arr[i + 2] = v.z * s;
    }
    return arr;
  }

  /** The core displacement, likewise — first three lobes, phase running backwards. */
  function originalCore(base, wobble, phase, coreScale) {
    const v = new THREE.Vector3();
    const arr = base.slice();
    for (let i = 0; i < arr.length; i += 3) {
      v.set(base[i], base[i + 1], base[i + 2]);
      let d = 0;
      for (let j = 0; j < 3; j++) {
        const l = lobes[j];
        d += l.amp * 1.5 * Math.sin(l.freq * v.dot(l.dir) * 2.6 - phase * l.speed * 3 + l.phase);
      }
      const s = (1 + d * wobble) * coreScale;
      arr[i] = v.x * s; arr[i + 1] = v.y * s; arr[i + 2] = v.z * s;
    }
    return arr;
  }

  const CASES = [
    { wobble: 1.15, phase: 0, breathe: 1 },
    { wobble: 1.6, phase: 3.7, breathe: 1.035 },
    { wobble: 0.55, phase: 128.25, breathe: 0.98 },
    { wobble: 2.17, phase: -4.5, breathe: 1.1 },
  ];

  it('reproduces the original shell displacement bit for bit', () => {
    for (const { wobble, phase, breathe } of CASES) {
      const geometry = new THREE.SphereGeometry(1, 32, 24);
      const base = geometry.attributes.position.array.slice();

      deform(geometry, base, lobes, {
        wobble, phase, scale: breathe, ampScale: 1, freqScale: 2.35, phaseScale: 2.2,
      });

      assert.deepEqual(
        Array.from(geometry.attributes.position.array),
        Array.from(originalShell(base, wobble, phase, breathe)),
        `shell mismatch at phase ${phase}`,
      );
    }
  });

  it('reproduces the original core displacement bit for bit', () => {
    for (const { wobble, phase } of CASES) {
      const geometry = new THREE.SphereGeometry(0.5, 16, 12);
      const base = geometry.attributes.position.array.slice();
      const coreScale = 1 + 0.16 * 0.4;

      // phaseScale -3 is how `- phase * l.speed * 3` survives the generalisation.
      deform(geometry, base, lobes.slice(0, 3), {
        wobble, phase, scale: coreScale, ampScale: 1.5, freqScale: 2.6, phaseScale: -3,
      });

      assert.deepEqual(
        Array.from(geometry.attributes.position.array),
        Array.from(originalCore(base, wobble, phase, coreScale)),
        `core mismatch at phase ${phase}`,
      );
    }
  });

  it('always reads the pristine base, so displacement never compounds', () => {
    const geometry = new THREE.SphereGeometry(1, 16, 12);
    const base = geometry.attributes.position.array.slice();
    const opts = { wobble: 1.2, phase: 2.5, scale: 1, ampScale: 1, freqScale: 2.35, phaseScale: 2.2 };

    deform(geometry, base, lobes, opts);
    const once = Array.from(geometry.attributes.position.array);
    deform(geometry, base, lobes, opts);

    assert.deepEqual(Array.from(geometry.attributes.position.array), once);
  });

  it('flags the attribute so the GPU picks the frame up', () => {
    const geometry = new THREE.SphereGeometry(1, 8, 6);
    // needsUpdate is write-only in three — setting it bumps `version`, which is
    // what the renderer actually reads.
    const before = geometry.attributes.position.version;
    deform(geometry, geometry.attributes.position.array.slice(), lobes, {
      wobble: 1, phase: 1, scale: 1, ampScale: 1, freqScale: 2.35, phaseScale: 2.2,
    });
    assert.ok(geometry.attributes.position.version > before, 'the frame would never reach the GPU');
  });

  it('leaves no NaN in the surface at zero wobble or zero scale', () => {
    for (const [wobble, scale] of [[0, 1], [1, 0], [0, 0]]) {
      const geometry = new THREE.SphereGeometry(1, 8, 6);
      deform(geometry, geometry.attributes.position.array.slice(), lobes, {
        wobble, phase: 1.5, scale, ampScale: 1, freqScale: 2.35, phaseScale: 2.2,
      });
      assert.ok(
        geometry.attributes.position.array.every(Number.isFinite),
        `wobble ${wobble} scale ${scale} produced a non-finite vertex`,
      );
    }
  });
});
