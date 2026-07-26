/**
 * The four pieces the orb is made of.
 *
 * Each builder returns its mesh plus whatever the animation loop needs to
 * deform or tint it — geometry, material, and a pristine copy of the base
 * vertex positions, since the live attribute array is overwritten every frame.
 *
 * Mesh and material names are load-bearing: the stage's OBJ export turns them
 * into `o` and `usemtl` entries.
 */

export function createShell(THREE) {
  const material = new THREE.MeshPhysicalMaterial({
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

  const geometry = new THREE.SphereGeometry(1, 128, 80);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'shell';

  return { mesh, geometry, material, base: geometry.attributes.position.array.slice() };
}

export function createCore(THREE) {
  const material = new THREE.MeshStandardMaterial({
    name: 'slime_core',
    color: new THREE.Color('#0d2a2c'),
    emissive: new THREE.Color('#38f2b6'),
    emissiveIntensity: 3.5,
    roughness: 0.35,
    metalness: 0,
    transparent: true,
    opacity: 0.95,
  });

  const geometry = new THREE.SphereGeometry(0.5, 64, 42);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'core';

  return { mesh, geometry, material, base: geometry.attributes.position.array.slice() };
}

/** A rim bloom bound to the shell's own geometry, not a second sphere — so it
 *  wobbles with the surface instead of floating around it. */
export function createGlow(THREE, shellGeometry) {
  const material = new THREE.ShaderMaterial({
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

  const mesh = new THREE.Mesh(shellGeometry, material);
  mesh.name = 'glow';

  return { mesh, material };
}

/** Bubbles suspended in the goo, each on its own slow orbit. */
export function createBubbles(THREE, count = 7) {
  const material = new THREE.MeshPhysicalMaterial({
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

  const meshes = [];
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.045 + (i % 3) * 0.028, 20, 14), material);
    mesh.name = 'bubble_' + (i + 1);
    const a = i * 2.399963;
    const rr = 0.42 + (i % 4) * 0.11;
    mesh.userData.orbit = { a, rr, y: -0.4 + i * 0.13, sp: 0.25 + (i % 3) * 0.14 };
    meshes.push(mesh);
  }

  return { meshes, material };
}
