const COUNT = 5;

export function createLobes(THREE, count = COUNT) {
  const lobes = [];
  for (let i = 0; i < count; i++) {
    const a = i * 2.399963;
    const r = Math.sqrt(1 - Math.pow(1 - 2 * (i + 0.5) / count, 2));
    lobes.push({
      dir: new THREE.Vector3(Math.cos(a) * r, 1 - 2 * (i + 0.5) / count, Math.sin(a) * r).normalize(),
      freq: 1.0 + i * 0.42,
      speed: 0.45 + i * 0.19,
      amp: 0.115 / (1 + i * 0.6),
      phase: i * 1.7,
    });
  }
  return lobes;
}
