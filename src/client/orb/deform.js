export function createDeformer(THREE) {
  const v = new THREE.Vector3();

  return function deform(geometry, base, lobes, { wobble, phase, scale, ampScale, freqScale, phaseScale }) {
    const attribute = geometry.attributes.position;
    const arr = attribute.array;

    for (let i = 0; i < arr.length; i += 3) {
      v.set(base[i], base[i + 1], base[i + 2]);
      let d = 0;
      for (const l of lobes) {
        d += l.amp * ampScale * Math.sin(l.freq * v.dot(l.dir) * freqScale + phase * l.speed * phaseScale + l.phase);
      }
      const s = (1 + d * wobble) * scale;
      arr[i] = v.x * s; arr[i + 1] = v.y * s; arr[i + 2] = v.z * s;
    }

    attribute.needsUpdate = true;
    geometry.computeVertexNormals();
  };
}
