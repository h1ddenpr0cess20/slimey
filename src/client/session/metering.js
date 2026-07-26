/**
 * Turning two live audio tracks into one 0..1 number per frame.
 *
 * One rAF loop reads whichever side of the call is making sound. Attack is
 * faster than release, which is what makes the surface feel like it's tracking
 * a voice rather than chasing it.
 */

/** RMS of one analyser frame, mapped to the orb's 0..1 energy. Speech sits
 *  around 0.05–0.2 RMS, so the gain lifts a normal speaking voice to most of
 *  the range without pinning it. */
export function amplitude(analyser, buffer) {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const v of buffer) sum += v * v;
  return Math.min(1, Math.sqrt(sum / buffer.length) * 7);
}

export function createAnalyser(audio, stream) {
  const node = audio.createAnalyser();
  node.fftSize = 1024;
  node.smoothingTimeConstant = 0.4;
  audio.createMediaStreamSource(stream).connect(node);
  // Parked on the node so the meter loop doesn't reallocate 60 times a second.
  node.buffer = new Float32Array(node.fftSize);
  return node;
}

const ATTACK = 0.45;
const RELEASE = 0.12;

/**
 * @param {() => AnalyserNode | null} pick  which side is live this frame
 * @param {(level: number) => void} onLevel
 */
export function createMeter(pick, onLevel) {
  let frame = 0;
  let level = 0;

  function tick() {
    frame = requestAnimationFrame(tick);
    const source = pick();
    const target = source ? amplitude(source, source.buffer) : 0;
    level += (target - level) * (target > level ? ATTACK : RELEASE);
    onLevel(level);
  }

  return {
    start() {
      if (!frame) frame = requestAnimationFrame(tick);
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      level = 0;
      onLevel(0);
    },
  };
}
