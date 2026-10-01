// The rim bloom: brightest at the silhouette, gone face-on.

uniform vec3 uColor; uniform float uStrength;
varying vec3 vN; varying vec3 vP;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(-vP)));
  float a = pow(f, 2.2) * (1.0 - pow(f, 8.0)) * uStrength;
  gl_FragColor = vec4(uColor * a, a);
}
