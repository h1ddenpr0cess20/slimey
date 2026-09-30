export function createShell(GFX) {
  const material = new GFX.MeshPhysicalMaterial({
    name: 'slime_shell',
    color: new GFX.Color('#38f2b6'),
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
    attenuationColor: new GFX.Color('#7ff0d8'),
    sheen: 0.5,
    sheenRoughness: 0.5,
    sheenColor: new GFX.Color('#ffffff'),
  });

  const geometry = new GFX.SphereGeometry(1, 128, 80);
  const mesh = new GFX.Mesh(geometry, material);
  mesh.name = 'shell';

  return { mesh, geometry, material, base: geometry.attributes.position.array.slice() };
}

export function createCore(GFX) {
  const material = new GFX.MeshStandardMaterial({
    name: 'slime_core',
    color: new GFX.Color('#0d2a2c'),
    emissive: new GFX.Color('#38f2b6'),
    emissiveIntensity: 3.5,
    roughness: 0.35,
    metalness: 0,
    transparent: true,
    opacity: 0.95,
  });

  const geometry = new GFX.SphereGeometry(0.5, 64, 42);
  const mesh = new GFX.Mesh(geometry, material);
  mesh.name = 'core';

  return { mesh, geometry, material, base: geometry.attributes.position.array.slice() };
}

export function createGlow(GFX, shellGeometry) {
  const material = new GFX.ShaderMaterial({
    name: 'slime_glow',
    uniforms: { uColor: { value: new GFX.Color('#38f2b6') }, uStrength: { value: 0.5 } },
    glsl: {
      vertex: `
        varying vec3 vN; varying vec3 vP;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position * 1.035, 1.0);
          vP = mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragment: `
        uniform vec3 uColor; uniform float uStrength;
        varying vec3 vN; varying vec3 vP;
        void main() {
          float f = 1.0 - abs(dot(normalize(vN), normalize(-vP)));
          float a = pow(f, 2.2) * (1.0 - pow(f, 8.0)) * uStrength;
          gl_FragColor = vec4(uColor * a, a);
        }`,
    },
    wgsl: `
      struct Varyings { @builtin(position) position: vec4f, @location(0) vN: vec3f, @location(1) vP: vec3f };
      @vertex fn vs(@location(0) position: vec3f, @location(1) normal: vec3f) -> Varyings {
        var out: Varyings;
        out.vN = normalize(object.normalMatrix * normal);
        let mv = object.modelViewMatrix * vec4f(position * 1.035, 1.0);
        out.vP = mv.xyz;
        out.position = object.projectionMatrix * mv;
        return out;
      }
      @fragment fn fs(in: Varyings) -> @location(0) vec4f {
        let f = 1.0 - abs(dot(normalize(in.vN), normalize(-in.vP)));
        let a = pow(f, 2.2) * (1.0 - pow(f, 8.0)) * material.uStrength;
        return vec4f(material.uColor * a, a);
      }`,
    transparent: true,
    blending: GFX.AdditiveBlending,
    side: GFX.FrontSide,
    depthWrite: false,
  });

  const mesh = new GFX.Mesh(shellGeometry, material);
  mesh.name = 'glow';

  return { mesh, material };
}

export function createBubbles(GFX, count = 7) {
  const material = new GFX.MeshPhysicalMaterial({
    name: 'slime_bubble',
    color: new GFX.Color('#eafffb'),
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
    const mesh = new GFX.Mesh(new GFX.SphereGeometry(0.045 + (i % 3) * 0.028, 20, 14), material);
    mesh.name = 'bubble_' + (i + 1);
    const a = i * 2.399963;
    const rr = 0.42 + (i % 4) * 0.11;
    mesh.userData.orbit = { a, rr, y: -0.4 + i * 0.13, sp: 0.25 + (i % 3) * 0.14 };
    meshes.push(mesh);
  }

  return { meshes, material };
}
