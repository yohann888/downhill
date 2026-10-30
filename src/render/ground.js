import * as THREE from 'three';

const loader = new THREE.TextureLoader();

function load(name, renderer, srgb) {
  const t = loader.load(`./assets/textures/${name}.webp`);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function loadGroundTextures(renderer) {
  return {
    trail: load('trail-diff', renderer, true),
    trailN: load('trail-nor', renderer, false),
    grass: load('grass-diff', renderer, true),
    grassN: load('grass-nor', renderer, false),
    rock: load('rock-diff', renderer, true),
    rockN: load('rock-nor', renderer, false),
  };
}

const VERTEX_HEAD = /* glsl */ `
attribute vec2 splat;
varying vec2 vSplat;
varying vec3 vGroundPos;
varying vec3 vGroundNormal;
`;

const VERTEX_BODY = /* glsl */ `
vSplat = splat;
vGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vGroundNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D tTrail, tGrass, tRock, nTrail, nGrass, nRock;
uniform vec3 groundScale;
uniform float normalStrength;
varying vec2 vSplat;
varying vec3 vGroundPos;
varying vec3 vGroundNormal;
vec4 tiled(sampler2D s, vec2 uv) {
  return mix(texture2D(s, uv), texture2D(s, uv * 0.29 + vec2(0.37, 0.71)), 0.4);
}
vec4 triplanar(sampler2D s, vec3 p, vec3 n, float k) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= w.x + w.y + w.z;
  return texture2D(s, p.zy / k) * w.x + texture2D(s, p.xz / k) * w.y + texture2D(s, p.xy / k) * w.z;
}
`;

const MAP_BODY = /* glsl */ `
vec2 gp = vGroundPos.xz;
vec4 cT = tiled(tTrail, gp / groundScale.x);
vec4 cG = tiled(tGrass, gp / groundScale.y);
cG.rgb *= vec3(0.82, 1.08, 0.62);
vec4 cR = triplanar(tRock, vGroundPos, normalize(vGroundNormal), groundScale.z);
float wT = vSplat.x;
float wR = vSplat.y * (1.0 - wT);
vec3 gW = vec3(wT, max(0.0, 1.0 - wT - wR), wR);
gW *= vec3(dot(cT.rgb, vec3(0.33)), dot(cG.rgb, vec3(0.33)), dot(cR.rgb, vec3(0.33))) + 0.3;
gW = gW * gW * gW;
gW /= max(1e-4, gW.x + gW.y + gW.z);
diffuseColor.rgb *= cT.rgb * gW.x + cG.rgb * gW.y + cR.rgb * gW.z;
`;

const NORMAL_BODY = /* glsl */ `
{
  vec3 tn = (tiled(nTrail, gp / groundScale.x).xyz * 2.0 - 1.0) * gW.x
    + (tiled(nGrass, gp / groundScale.y).xyz * 2.0 - 1.0) * gW.y
    + (texture2D(nRock, gp / groundScale.z).xyz * 2.0 - 1.0) * gW.z;
  tn.xy *= normalStrength;
  vec3 tv = normalize(mat3(viewMatrix) * vec3(1.0, 0.0, 0.0));
  tv = normalize(tv - normal * dot(normal, tv));
  vec3 bv = cross(tv, normal);
  normal = normalize(tv * tn.x + bv * tn.y + normal * max(0.2, tn.z));
}
`;

export function createGroundMaterial(textures, { scale = 1, normalStrength = 1 } = {}) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      tTrail: { value: textures.trail },
      tGrass: { value: textures.grass },
      tRock: { value: textures.rock },
      nTrail: { value: textures.trailN },
      nGrass: { value: textures.grassN },
      nRock: { value: textures.rockN },
      groundScale: { value: new THREE.Vector3(3.5, 5, 9).multiplyScalar(scale) },
      normalStrength: { value: normalStrength },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_HEAD}`)
      .replace('#include <map_fragment>', MAP_BODY)
      .replace('#include <normal_fragment_maps>', NORMAL_BODY);
  };
  material.customProgramCacheKey = () => 'ground';
  return material;
}
