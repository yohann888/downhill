import * as THREE from 'three';
import { createRandom } from '../world/noise.js';

const CHUNK_LENGTH = 40;
const COVER_AHEAD = 90;
const COVER_BEHIND = 25;
const GRASS_HEIGHT = 0.6;
const FERN_HEIGHT = 0.45;

export const windTime = { value: 0 };

// Bends vertices after the instance transform so every clump sways the same way in world space.
export function addWind(material, { height, amplitude, frequency, key }) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    shader.uniforms.uWindTime = windTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
mvPosition = instanceMatrix * mvPosition;
vec3 windRoot = instanceMatrix[3].xyz;
#else
vec3 windRoot = vec3(0.0);
#endif
float windWeight = clamp(position.y / ${height.toFixed(3)}, 0.0, 1.0);
windWeight *= windWeight;
float windPhase = uWindTime * ${frequency.toFixed(3)} + windRoot.x * 0.35 + windRoot.z * 0.27;
float windGust = 0.65 + 0.35 * sin(uWindTime * 0.37 + windRoot.z * 0.021);
mvPosition.x += (sin(windPhase) + 0.6) * ${amplitude.toFixed(3)} * windGust * windWeight;
mvPosition.z += cos(windPhase * 0.83) * ${(amplitude * 0.5).toFixed(3)} * windGust * windWeight;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${previousKey?.() ?? ''}|wind-${key}`;
  material.needsUpdate = true;
  return material;
}

export function groundCoverPlacements(terrain, seed = 7) {
  const random = createRandom(seed);
  const items = [];
  for (let s = 2; s <= terrain.courseLength + 20; s += 0.4) {
    for (const side of [-1, -1, 1, 1]) {
      const z = -s + (random() - 0.5) * 0.5;
      const near = random() < 0.85;
      const outside = near ? 0.1 + random() ** 1.7 * 5 : 5 + random() * 14;
      const keep = near || random() < 0.4;
      const fernRoll = random();
      const yaw = random() * Math.PI * 2;
      const size = random();
      const tint = random();
      if (!keep) continue;
      const x = terrain.centerX(z) + side * (terrain.halfWidth(z) + outside);
      if ((terrain.pathWeightAt?.(x, z) ?? 0) > 0.2) continue;
      const kind = fernRoll < (outside > 1.2 ? 0.12 : 0.02) ? 'fern' : 'grass';
      const edge = outside < 0.6 ? 0.7 : 1;
      items.push({
        kind,
        x,
        y: terrain.heightAt(x, z),
        z,
        yaw,
        scale: (kind === 'fern' ? 0.7 + size * 0.6 : 0.8 + size * 0.9) * edge,
        tint,
      });
    }
  }
  return items;
}

function stripGeometry(strips) {
  const positions = [];
  const colors = [];
  const indices = [];
  for (const strip of strips) {
    const start = positions.length / 3;
    strip.points.forEach((point, i) => {
      const t = i / (strip.points.length - 1);
      const half = strip.width(t) / 2;
      for (const side of [-1, 1]) {
        positions.push(point.x + strip.side.x * half * side, point.y, point.z + strip.side.z * half * side);
        const color = strip.base.clone().lerp(strip.tip, t);
        colors.push(color.r, color.g, color.b);
      }
      if (i > 0) {
        const a = start + (i - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(
    positions.map((_, i) => (i % 3 === 1 ? 1 : 0)),
    3,
  ));
  geometry.setIndex(indices);
  return geometry;
}

function grassClump() {
  const random = createRandom(3);
  const strips = [];
  for (let i = 0; i < 16; i += 1) {
    const angle = (i / 16) * Math.PI * 2 + random();
    const lean = 0.12 + random() * 0.25;
    const height = GRASS_HEIGHT * (0.55 + random() * 0.45);
    const radius = random() * 0.22;
    const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const points = [0, 0.5, 1].map((t) => new THREE.Vector3(
      out.x * (radius + lean * height * t * t),
      height * t,
      out.z * (radius + lean * height * t * t),
    ));
    strips.push({
      points,
      side: new THREE.Vector3(-out.z, 0, out.x),
      width: (t) => 0.075 * (1 - t) + 0.006,
      base: new THREE.Color(0x4a5e2a),
      tip: new THREE.Color(random() < 0.4 ? 0xcbb86a : 0xa3ae55),
    });
  }
  return stripGeometry(strips);
}

function fernClump() {
  const random = createRandom(5);
  const strips = [];
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI * 2 + random() * 0.5;
    const length = 0.55 + random() * 0.25;
    const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const points = Array.from({ length: 6 }, (_, k) => {
      const t = k / 5;
      return new THREE.Vector3(out.x * length * t, FERN_HEIGHT * Math.sin(t * Math.PI * 0.75), out.z * length * t);
    });
    strips.push({
      points,
      side: new THREE.Vector3(-out.z, 0, out.x),
      width: (t) => 0.2 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.015,
      base: new THREE.Color(0x34521f),
      tip: new THREE.Color(0x7aa142),
    });
  }
  return stripGeometry(strips);
}

function coverMaterial(key, height, amplitude) {
  return addWind(
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }),
    { height, amplitude, frequency: 2.2, key },
  );
}

export function chunkVisible(chunk, cameraZ, ahead = COVER_AHEAD, behind = COVER_BEHIND) {
  const nearS = chunk * CHUNK_LENGTH;
  const cameraS = -cameraZ;
  return nearS + CHUNK_LENGTH >= cameraS - behind && nearS <= cameraS + ahead;
}

export function buildGroundCover(terrain) {
  const group = new THREE.Group();
  const kinds = {
    grass: { geometry: grassClump(), material: coverMaterial('grass', GRASS_HEIGHT, 0.06) },
    fern: { geometry: fernClump(), material: coverMaterial('fern', FERN_HEIGHT, 0.04) },
  };
  const chunks = new Map();
  for (const item of groundCoverPlacements(terrain)) {
    const key = `${item.kind}:${Math.floor(-item.z / CHUNK_LENGTH)}`;
    if (!chunks.has(key)) chunks.set(key, []);
    chunks.get(key).push(item);
  }
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  for (const [key, items] of chunks) {
    const { geometry, material } = kinds[key.split(':')[0]];
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    items.forEach((item, i) => {
      position.set(item.x, item.y - 0.02, item.z);
      quaternion.setFromAxisAngle(up, item.yaw);
      scale.setScalar(item.scale);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
      color.setRGB(0.85 + item.tint * 0.3, 0.9 + item.tint * 0.15, 0.8 + (1 - item.tint) * 0.2);
      mesh.setColorAt(i, color);
    });
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    mesh.userData.chunk = Number(key.split(':')[1]);
    mesh.userData.noAO = true;
    group.add(mesh);
  }
  group.userData.cull = (cameraZ) => {
    for (const mesh of group.children) mesh.visible = chunkVisible(mesh.userData.chunk, cameraZ);
  };
  return group;
}
