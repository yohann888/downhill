import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { OUT_OF_BOUNDS } from '../physics/constants.js';
import { createRandom, createValueNoise } from '../world/noise.js';
import { crossProfile } from '../world/terrain.js';
import { unitMesh } from './assets.js';
import { createGroundMaterial, loadGroundTextures } from './ground.js';
import {
  createOtterStickerMaterial,
  disposeOtterMesh,
  prepareOtterMesh,
  updateOtterMesh,
} from './otter.js';
import { buildPickups } from './pickups.js';

const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const SKY_ROTATION = 1.92;

const SUN_DIRECTION = new THREE.Vector3().setFromSphericalCoords(
  1,
  THREE.MathUtils.degToRad(90 - 9),
  THREE.MathUtils.degToRad(200),
);
const MOON_LIGHT_DIRECTION = new THREE.Vector3().setFromSphericalCoords(
  1,
  THREE.MathUtils.degToRad(63),
  THREE.MathUtils.degToRad(170),
);
const MOON_DIRECTION = new THREE.Vector3().setFromSphericalCoords(
  1,
  THREE.MathUtils.degToRad(72),
  THREE.MathUtils.degToRad(170),
);

function createNightSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      horizon: { value: new THREE.Color(0x18233d) },
      zenith: { value: new THREE.Color(0x030714) },
      moonDirection: { value: MOON_DIRECTION.clone() },
      moonHaze: { value: new THREE.Color(0x57c5d8) },
    },
    vertexShader: `
      varying float vHeight;
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        vHeight = vDirection.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 horizon;
      uniform vec3 zenith;
      uniform vec3 moonDirection;
      uniform vec3 moonHaze;
      varying float vHeight;
      varying vec3 vDirection;
      void main() {
        float gradient = smoothstep(-0.1, 0.85, vHeight);
        float moonGlow = pow(max(dot(normalize(vDirection), normalize(moonDirection)), 0.0), 32.0);
        float horizonFade = 1.0 - smoothstep(-0.1, 0.65, vHeight);
        vec3 color = mix(horizon, zenith, gradient);
        color += moonHaze * moonGlow * (0.45 + 0.55 * horizonFade);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

function createStars() {
  const random = createRandom(910);
  const positions = new Float32Array(2500 * 3);
  for (let index = 0; index < 2500; index += 1) {
    const y = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const horizontal = Math.sqrt(1 - y * y);
    positions[index * 3] = horizontal * Math.cos(angle) * 6000;
    positions[index * 3 + 1] = y * 6000;
    positions[index * 3 + 2] = horizontal * Math.sin(angle) * 6000;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0xdce6ff,
      size: 2.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
    }),
  );
  points.frustumCulled = false;
  return points;
}

function createMoonGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(225,235,255,0.65)');
  gradient.addColorStop(0.25, 'rgba(165,190,255,0.24)');
  gradient.addColorStop(1, 'rgba(115,145,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function acrossOffsets() {
  const offsets = [];
  for (let d = -260; d <= -110; d += 10) offsets.push(d);
  for (let d = -108; d >= -36; d -= 4) offsets.push(d);
  for (let d = -32; d <= -15; d += 1) offsets.push(d);
  for (let d = -14; d <= 14; d += 0.5) offsets.push(d);
  for (let d = 15; d <= 32; d += 1) offsets.push(d);
  for (let d = 36; d <= 108; d += 4) offsets.push(d);
  offsets.push(110);
  for (let d = 120; d <= 260; d += 10) offsets.push(d);
  return offsets;
}

function buildCourseMesh(terrain, groundTextures) {
  const { farHeight } = createFarHeight(terrain);
  const offsets = acrossOffsets();
  const tint = createValueNoise(11);
  const rows = [];
  for (let s = -40; s <= terrain.courseLength + 60; s += 1) rows.push(-s);
  const cols = offsets.length;
  const positions = new Float32Array(rows.length * cols * 3);
  const colors = new Float32Array(rows.length * cols * 3);
  const splat = new Float32Array(rows.length * cols * 2);
  let p = 0;
  for (const z of rows) {
    const cx = terrain.centerX(z);
    const hw = terrain.halfWidth(z);
    for (const d of offsets) {
      const x = cx + d;
      const blend = smoothstep(130, 250, Math.abs(d));
      const y = blend > 0
        ? terrain.heightAt(x, z) * (1 - blend) + farHeight(x, z).y * blend
        : terrain.heightAt(x, z);
      positions[p] = x;
      positions[p + 1] = y;
      positions[p + 2] = z;
      const n = tint(x / 6, z / 6) * 0.5 + 0.5;
      const m = tint(x / 40 + 9, z / 40) * 0.5 + 0.5;
      const ad = Math.abs(d);
      const q = (p / 3) * 2;
      splat[q] = Math.max(
        1 -
          smoothstep(
            hw - 0.5 + (n - 0.5) * 0.8,
            hw + 0.9 + (n - 0.5) * 1.2,
            ad,
          ),
        terrain.pathWeightAt(x, z),
      );
      splat[q + 1] = smoothstep(30, 90, ad) * (0.4 + 0.5 * n);
      const t = 0.82 + 0.3 * n;
      colors[p] = t * (1 + 0.12 * (m - 0.5));
      colors[p + 1] = t;
      colors[p + 2] = t * (0.94 - 0.1 * (m - 0.5));
      p += 3;
    }
  }
  const index = [];
  for (let r = 0; r < rows.length - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      index.push(a, b, d, b, e, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal;
  for (let i = 0; i < normals.count; i += 1) {
    const steep = smoothstep(0.9, 0.72, normals.getY(i));
    splat[i * 2 + 1] = Math.max(splat[i * 2 + 1], steep) * (1 - splat[i * 2]);
  }
  geometry.setAttribute('splat', new THREE.BufferAttribute(splat, 2));
  const mesh = new THREE.Mesh(geometry, createGroundMaterial(groundTextures));
  mesh.receiveShadow = true;
  return mesh;
}

function courseBaseline(terrain, z) {
  const zc = Math.min(0, Math.max(terrain.finishZ, z));
  const base = terrain.heightAt(terrain.centerX(zc), zc);
  if (z > 0) return base + z * 0.1;
  if (z < terrain.finishZ) {
    const finishY = base;
    return finishY - 45 * smoothstep(0, 220, terrain.finishZ - z);
  }
  return base;
}

function createFarHeight(terrain) {
  const ridge = createValueNoise(23);
  const detail = createValueNoise(29);
  const lakeY = courseBaseline(terrain, terrain.finishZ - 400);
  const farHeight = (x, z) => {
    const zc = Math.min(0, Math.max(terrain.finishZ, z));
    const signed = x - terrain.centerX(zc);
    let distance = Math.abs(signed);
    if (z > 0) distance = Math.hypot(distance, z);
    if (z < terrain.finishZ) distance = Math.hypot(distance, (terrain.finishZ - z) * 0.35);
    const baseline = courseBaseline(terrain, z);
    const cross = signed < 0 ? crossProfile(signed, 3) : Math.max(lakeY - baseline, crossProfile(signed, 3));
    let fbm = 0;
    let amp = 1;
    let freq = 1 / 700;
    for (let o = 0; o < 5; o += 1) {
      const n = 1 - Math.abs(ridge(x * freq, z * freq));
      fbm += n * n * amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    const mask = smoothstep(100, 900, distance);
    const valley = smoothstep(terrain.finishZ - 150, terrain.finishZ - 700, z) * (1 - smoothstep(-2600, -3400, z));
    return {
      y: baseline + cross + fbm * 520 * mask * (1 - 0.85 * valley) + detail(x / 90, z / 90) * 12 * mask,
      distance,
    };
  };
  return { farHeight, lakeY };
}

function buildRangeMesh(terrain, groundTextures) {
  const size = 7000;
  const segments = 480;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, -terrain.courseLength * 0.75);
  const { farHeight, lakeY } = createFarHeight(terrain);
  const detail = createValueNoise(29);
  const pos = geometry.attributes.position;
  const distances = new Float32Array(pos.count);
  const colors = new Float32Array(pos.count * 3);
  const splat = new Float32Array(pos.count * 2);
  const forest = new THREE.Color(0.42, 0.55, 0.36);
  const stone = new THREE.Color(1, 1, 1);
  const snow = new THREE.Color(2.4, 2.45, 2.6);
  const haze = new THREE.Color(0xb9c3cb);
  const color = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const far = farHeight(x, z);
    const y = far.y - 45 * (1 - smoothstep(210, 255, far.distance));
    pos.setY(i, y);
    distances[i] = far.distance;
  }
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const rel = pos.getY(i) - lakeY;
    const steep = 1 - smoothstep(0.72, 0.78, normals.getY(i));
    const stoneW = Math.max(smoothstep(140, 260, rel), steep);
    const snowW =
      smoothstep(290, 360, rel + detail(x / 40, z / 40) * 40) * (1 - steep);
    color
      .copy(forest)
      .lerp(stone, stoneW)
      .lerp(snow, snowW)
      .lerp(haze, 0.55 * smoothstep(300, 3000, distances[i]));
    splat[i * 2 + 1] = Math.max(stoneW, snowW);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('splat', new THREE.BufferAttribute(splat, 2));
  const mesh = new THREE.Mesh(geometry, createGroundMaterial(groundTextures, { scale: 9, normalStrength: 0.6 }));
  mesh.receiveShadow = false;
  const lake = new THREE.Mesh(
    new THREE.PlaneGeometry(5000, 2600).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x3d6f8a, roughness: 0.08, metalness: 0.6 }),
  );
  lake.position.set(0, lakeY - 4, terrain.finishZ - 1500);
  const group = new THREE.Group();
  group.add(mesh, lake);
  return group;
}

function buildTrees(terrain, obstacles) {
  const random = createRandom(41);
  const variationRandom = createRandom(97);
  const placements = obstacles
    .filter((o) => o.type === 'tree')
    .map((o, i) => {
      random();
      return {
        x: o.x,
        z: o.z,
        scale: o.treeScale ?? 1,
        variant: o.treeVariant ?? i % 2,
        yaw: variationRandom() * Math.PI * 2,
        obstacle: true,
      };
    });
  let backgroundIndex = 0;
  for (let s = -30; s <= terrain.courseLength + 50; s += 1.6) {
    const z = -s;
    for (const side of [-1, 1]) {
      if (random() > 0.85) continue;
      const hw = terrain.halfWidth(z);
      const d = hw + OUT_OF_BOUNDS + 1 + Math.pow(random(), 1.6) * 95;
      placements.push({
        x: terrain.centerX(z) + side * d,
        z: z + (random() - 0.5) * 1.5,
        scale: 0.8 + random() * 0.9,
        variant: backgroundIndex % 2,
        yaw: variationRandom() * Math.PI * 2,
        obstacle: false,
      });
      backgroundIndex += 1;
    }
  }
  const treePalette = [
    { weight: 0.34, color: new THREE.Color(0.88, 1, 0.9) },
    { weight: 0.22, color: new THREE.Color(0.78, 0.93, 1.05) },
    { weight: 0.2, color: new THREE.Color(1.02, 1.06, 0.8) },
    { weight: 0.18, color: new THREE.Color(1.06, 1, 0.78) },
    { weight: 0.06, color: new THREE.Color(1.3, 0.86, 0.5) },
  ];
  const tintTree = () => {
    let choice = variationRandom();
    let selected = treePalette[treePalette.length - 1].color;
    for (const entry of treePalette) {
      choice -= entry.weight;
      if (choice < 0) {
        selected = entry.color;
        break;
      }
    }
    return selected.clone().multiplyScalar(0.85 + variationRandom() * 0.25);
  };
  for (const tree of placements) {
    const spire = !tree.obstacle && variationRandom() < 0.12;
    tree.heightFactor = spire ? 1.45 : 0.85 + variationRandom() * 0.45;
    tree.widthFactor = spire
      ? 0.72
      : tree.obstacle
        ? 0.92 + variationRandom() * 0.16
        : 0.85 + variationRandom() * 0.3;
    tree.tint = tintTree();
  }
  const trunkGeometry = new THREE.CylinderGeometry(0.18, 0.28, 2.2, 6).translate(0, 1.1, 0);
  const foliageGeometry = new THREE.ConeGeometry(1.7, 6.5, 7).translate(0, 5, 0);
  const trunks = new THREE.InstancedMesh(
    trunkGeometry,
    new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 1 }),
    placements.length,
  );
  const foliage = new THREE.InstancedMesh(
    foliageGeometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }),
    placements.length,
  );
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const color = new THREE.Color();
  placements.forEach((tree, i) => {
    position.set(tree.x, terrain.heightAt(tree.x, tree.z), tree.z);
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tree.yaw);
    scale.set(tree.scale * tree.widthFactor, tree.scale * tree.heightFactor, tree.scale * tree.widthFactor);
    matrix.compose(position, quat, scale);
    trunks.setMatrixAt(i, matrix);
    foliage.setMatrixAt(i, matrix);
    color.copy(tree.tint);
    foliage.setColorAt(i, color);
  });
  foliage.instanceColor.needsUpdate = true;
  trunks.castShadow = true;
  foliage.castShadow = true;
  foliage.receiveShadow = true;
  const group = new THREE.Group();
  group.add(trunks, foliage);
  group.userData.swap = (variants) => {
    const required = new Set(placements.map((tree) => tree.variant));
    if ([...required].some((variant) => !variants[variant])) return;
    trunks.visible = false;
    foliage.visible = false;
    variants.forEach((variant, v) => {
      if (!variant) return;
      const mine = placements.filter((tree) => tree.variant === v);
      if (!mine.length) return;
      const mesh = new THREE.InstancedMesh(variant.geometry, variant.material, mine.length);
      mine.forEach((tree, i) => {
        position.set(tree.x, terrain.heightAt(tree.x, tree.z), tree.z);
        quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tree.yaw);
        scale.set(
          10 * tree.scale * tree.widthFactor,
          10 * tree.scale * tree.heightFactor,
          10 * tree.scale * tree.widthFactor,
        );
        matrix.compose(position, quat, scale);
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, tree.tint);
      });
      mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
  };
  return group;
}

function buildObstacles(terrain, obstacles, renderer, nightMaterials) {
  const group = new THREE.Group();
  const movingMeshes = [];
  const otterMeshes = [];
  const stickerMaterial = createOtterStickerMaterial(renderer);
  let otterTemplate = null;
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x86827a, roughness: 0.9, flatShading: true });
  nightMaterials.add(rockMaterial);
  const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x6a4a2e, roughness: 0.9 });
  const cutMaterial = new THREE.MeshStandardMaterial({ color: 0xc19a6b, roughness: 0.9 });
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  for (const o of obstacles) {
    if (o.type === 'tree') continue;
    let mesh;
    if (o.type === 'rock') {
      mesh = new THREE.Mesh(rockGeometry, rockMaterial);
      mesh.scale.set(o.r * 1.05, o.h * 0.75, o.r * 0.95);
      mesh.position.set(o.x, terrain.heightAt(o.x, o.z) + o.h * 0.25, o.z);
      mesh.rotation.y = o.walk && o.dir < 0 ? -Math.PI / 2 : Math.PI / 2;
      mesh.userData.yOffset = o.h * 0.25;
      if (o.walk) movingMeshes.push(mesh);
    } else if (o.type === 'stump') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 1.2, o.h, 10), [woodMaterial, cutMaterial, woodMaterial]);
      mesh.position.set(o.x, terrain.heightAt(o.x, o.z) + o.h / 2, o.z);
    } else {
      const length = Math.hypot(o.x2 - o.x1, o.z2 - o.z1);
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r, length + 0.3, 10), [woodMaterial, cutMaterial, cutMaterial]);
      mesh.rotation.order = 'YXZ';
      mesh.rotation.y = -Math.atan2(o.z2 - o.z1, o.x2 - o.x1);
      mesh.rotation.z = Math.PI / 2;
      mesh.position.set(o.x, terrain.heightAt(o.x, o.z) + o.r, o.z);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.obstacle = o;
    group.add(mesh);
  }
  group.userData.swap = (byType) => {
    for (const mesh of group.children) {
      const o = mesh.userData.obstacle;
      const otter = o.type === 'rock' && byType.otter;
      const model = o.type === 'rock'
        ? (otter || (o.h < 0.55 ? byType['rock-flat'] : byType.boulder))
        : byType[o.type];
      if (!model) continue;
      const ground = terrain.heightAt(o.x, o.z);
      mesh.geometry = model.geometry;
      mesh.material = model.material;
      mesh.rotation.set(0, o.rot, 0);
      if (o.type === 'rock') {
        mesh.userData.yOffset = 0;
        mesh.rotation.y = o.dir < 0 ? -Math.PI / 2 : Math.PI / 2;
        if (otter) {
          otterTemplate ??= new THREE.Mesh(model.geometry, model.material);
          prepareOtterMesh(mesh, renderer, stickerMaterial);
          otterMeshes.push(mesh);
        }
      }
      if (o.type === 'log') {
        const length = Math.hypot(o.x2 - o.x1, o.z2 - o.z1) + 0.3;
        const ext = model.geometry.boundingBox.getSize(new THREE.Vector3());
        const longOnX = ext.x >= ext.z;
        const width = o.r * 2;
        mesh.rotation.y = -Math.atan2(o.z2 - o.z1, o.x2 - o.x1) + (longOnX ? 0 : Math.PI / 2);
        mesh.scale.set(
          longOnX ? length / ext.x : width / ext.x,
          o.h / ext.y,
          longOnX ? width / ext.z : length / ext.z,
        );
        mesh.position.set(o.x, ground, o.z);
      } else if (otter) {
        const ext = model.geometry.boundingBox.getSize(new THREE.Vector3());
        mesh.scale.setScalar((Math.max(o.r, 0.4) * 2) / Math.max(ext.x, ext.z));
        mesh.position.set(o.x, ground, o.z);
      } else {
        const ext = model.geometry.boundingBox.getSize(new THREE.Vector3());
        mesh.scale.set((o.r * 2) / ext.x, o.h / ext.y, (o.r * 2) / ext.z);
        mesh.position.set(o.x, ground, o.z);
      }
    }
  };
  let lastTime = 0;
  group.userData.update = (time) => {
    const deltaTime = Math.max(0, Math.min(0.1, time - lastTime));
    const turnAlpha = 1 - Math.exp(-10 * deltaTime);
    lastTime = time;
    for (const mesh of movingMeshes) {
      const o = mesh.userData.obstacle;
      const targetYaw = o.dir < 0 ? -Math.PI / 2 : Math.PI / 2;
      const yawDelta = Math.atan2(
        Math.sin(targetYaw - mesh.rotation.y),
        Math.cos(targetYaw - mesh.rotation.y),
      );
      mesh.rotation.y += yawDelta * turnAlpha;
      const waddlePhase = time * Math.PI * 8 + o.walk.phase;
      mesh.rotation.z = Math.sin(waddlePhase) * 0.12;
      mesh.position.set(
        o.x,
        terrain.heightAt(o.x, o.z)
          + mesh.userData.yOffset
          + Math.sin(waddlePhase) * 0.04,
        o.z,
      );
    }
    for (const mesh of otterMeshes) updateOtterMesh(mesh, time);
  };
  group.userData.createWaveOtter = () => {
    if (!otterTemplate) return null;
    const mesh = otterTemplate.clone();
    prepareOtterMesh(mesh, renderer, stickerMaterial);
    return mesh;
  };
  group.userData.updateWaveOtter = (mesh, time, wave) => {
    updateOtterMesh(mesh, time, wave);
  };
  group.userData.disposeWaveOtter = (mesh) => disposeOtterMesh(mesh);
  return group;
}

function buildMarkers(terrain) {
  const group = new THREE.Group();
  const post = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
  const banner = new THREE.MeshStandardMaterial({ color: 0xffb547, roughness: 0.6 });
  const flag = new THREE.MeshStandardMaterial({ color: 0xff5a36, roughness: 0.7, side: THREE.DoubleSide });
  const arch = (z, width) => {
    const cx = terrain.centerX(z);
    const heading = Math.atan2(terrain.centerX(z - 0.5) - terrain.centerX(z + 0.5), 1);
    const g = new THREE.Group();
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4, 0.25), post);
      p.position.set(side * width, 2, 0);
      g.add(p);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(width * 2 + 0.4, 0.8, 0.15), banner);
    top.position.y = 3.8;
    g.add(top);
    g.position.set(cx, terrain.heightAt(cx, z), z);
    g.rotation.y = -heading;
    g.traverse((m) => { m.castShadow = true; });
    group.add(g);
  };
  arch(-2, terrain.halfWidth(-2) + 0.8);
  arch(terrain.finishZ, terrain.halfWidth(terrain.finishZ) + 0.8);
  for (const cp of terrain.checkpoints) {
    for (const side of [-1, 1]) {
      const x = cp.x + side * (terrain.halfWidth(cp.z) + 0.6);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), post);
      pole.position.set(x, terrain.heightAt(x, cp.z) + 1.1, cp.z);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), flag);
      f.position.set(x + side * -0.35, terrain.heightAt(x, cp.z) + 1.95, cp.z);
      group.add(pole, f);
    }
  }
  return group;
}

export function buildWorld(scene, renderer, terrain, obstacles, pickups = []) {
  let timeMode = 'day';
  const sky = new Sky();
  sky.scale.setScalar(20000);
  const u = sky.material.uniforms;
  u.turbidity.value = 5;
  u.rayleigh.value = 1.6;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(SUN_DIRECTION);
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  Object.assign(envSky.material.uniforms.sunPosition.value, SUN_DIRECTION);
  for (const key of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) {
    envSky.material.uniforms[key].value = u[key].value;
  }
  envScene.add(envSky);
  let dayEnvironment = pmrem.fromScene(envScene).texture;
  scene.environment = dayEnvironment;
  scene.environmentIntensity = 0.55;
  let dayBackground = scene.background;
  const dayBackgroundRotation = scene.backgroundRotation.clone();
  const dayEnvironmentRotation = scene.environmentRotation.clone();
  const nightEnvironmentScene = new THREE.Scene();
  nightEnvironmentScene.background = new THREE.Color(0x030714);
  nightEnvironmentScene.add(new THREE.Mesh(
    new THREE.SphereGeometry(100, 32, 16),
    createNightSkyMaterial(),
  ));
  const environmentMoon = new THREE.Mesh(
    new THREE.CircleGeometry(8, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide }),
  );
  environmentMoon.position.copy(MOON_DIRECTION).multiplyScalar(98);
  environmentMoon.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    MOON_DIRECTION.clone().negate(),
  );
  nightEnvironmentScene.add(environmentMoon);
  const nightEnvironment = pmrem.fromScene(nightEnvironmentScene, 0.1).texture;
  nightEnvironmentScene.traverse((object) => {
    object.geometry?.dispose();
    if (object.material) object.material.dispose();
  });
  const nightSky = new THREE.Mesh(
    new THREE.SphereGeometry(7000, 32, 20),
    createNightSkyMaterial(),
  );
  nightSky.frustumCulled = false;
  nightSky.visible = false;
  const stars = createStars();
  stars.visible = false;
  const moonPosition = MOON_DIRECTION.clone().multiplyScalar(5000);
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(140, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }),
  );
  moon.position.copy(moonPosition);
  moon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), MOON_DIRECTION.clone().negate());
  moon.visible = false;
  const moonGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: createMoonGlowTexture(),
    color: 0xc6e8ff,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }));
  moonGlow.position.copy(moonPosition);
  moonGlow.scale.set(780, 780, 1);
  moonGlow.visible = false;
  const moonHalo = new THREE.Mesh(
    new THREE.TorusGeometry(235, 7, 8, 96),
    new THREE.MeshBasicMaterial({
      color: 0x8edcff,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    }),
  );
  moonHalo.position.copy(moonPosition);
  moonHalo.quaternion.copy(moon.quaternion);
  moonHalo.visible = false;
  scene.add(nightSky, stars, moonGlow, moonHalo, moon);
  const nightMaterials = new Set();
  const originalRoughness = new Map();
  const setNightMaterials = (isNight) => {
    for (const material of nightMaterials) {
      if (!originalRoughness.has(material)) originalRoughness.set(material, material.roughness);
      material.roughness = isNight
        ? Math.min(originalRoughness.get(material), 0.75)
        : originalRoughness.get(material);
    }
  };
  const pineMaterials = [];
  new THREE.TextureLoader().load('./assets/textures/sky.webp', (skyTexture) => {
    skyTexture.mapping = THREE.EquirectangularReflectionMapping;
    skyTexture.colorSpace = THREE.SRGBColorSpace;
    dayBackground = skyTexture;
    dayEnvironment = pmrem.fromEquirectangular(skyTexture).texture;
    dayBackgroundRotation.y = SKY_ROTATION;
    dayEnvironmentRotation.y = SKY_ROTATION;
    if (timeMode === 'day') {
      scene.background = dayBackground;
      scene.backgroundRotation.copy(dayBackgroundRotation);
      scene.environmentRotation.copy(dayEnvironmentRotation);
      scene.environment = dayEnvironment;
    }
    for (const material of pineMaterials) {
      material.envMap = timeMode === 'night' ? nightEnvironment : dayEnvironment;
      material.needsUpdate = true;
    }
    scene.remove(sky);
  });

  scene.fog = new THREE.FogExp2(0xb9c3cb, 0.0003);

  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a3b28, 0.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd2a1, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const groundTextures = loadGroundTextures(renderer);
  const course = buildCourseMesh(terrain, groundTextures);
  nightMaterials.add(course.material);
  scene.add(course);
  scene.add(buildRangeMesh(terrain, groundTextures));
  const trees = buildTrees(terrain, obstacles);
  const obstacleGroup = buildObstacles(terrain, obstacles, renderer, nightMaterials);
  const pickupModels = buildPickups(terrain, pickups);
  scene.add(trees, obstacleGroup, pickupModels.group);
  scene.add(buildMarkers(terrain));
  const daySunColor = sun.color.clone();
  const daySunIntensity = sun.intensity;
  const daySkyColor = hemi.color.clone();
  const dayGroundColor = hemi.groundColor.clone();
  const dayHemiIntensity = hemi.intensity;
  const dayFogColor = scene.fog.color.clone();
  const dayFogDensity = scene.fog.density;
  const activeLightDirection = { value: SUN_DIRECTION };
  const followTarget = new THREE.Vector3();
  function setTimeOfDay(mode) {
    timeMode = mode === 'night' ? 'night' : 'day';
    const isNight = timeMode === 'night';
    sky.visible = !isNight;
    nightSky.visible = isNight;
    stars.visible = isNight;
    moon.visible = isNight;
    moonGlow.visible = isNight;
    moonHalo.visible = isNight;
    if (isNight) {
      scene.background = new THREE.Color(0x030714);
      scene.environmentRotation.set(0, 0, 0);
      scene.environment = nightEnvironment;
      scene.environmentIntensity = 0.25;
      sun.color.set(0xc8f0ff);
      sun.intensity = 2.8;
      hemi.color.set(0x1a2a4a);
      hemi.groundColor.set(0x05070c);
      hemi.intensity = 0.12;
      scene.fog.color.set(0x1b2a3a);
      scene.fog.density = 0.0006;
      activeLightDirection.value = MOON_LIGHT_DIRECTION;
    } else {
      scene.background = dayBackground;
      scene.backgroundRotation.copy(dayBackgroundRotation);
      scene.environmentRotation.copy(dayEnvironmentRotation);
      scene.environment = dayEnvironment;
      scene.environmentIntensity = 0.55;
      sun.color.copy(daySunColor);
      sun.intensity = daySunIntensity;
      hemi.color.copy(daySkyColor);
      hemi.groundColor.copy(dayGroundColor);
      hemi.intensity = dayHemiIntensity;
      scene.fog.color.copy(dayFogColor);
      scene.fog.density = dayFogDensity;
      activeLightDirection.value = SUN_DIRECTION;
    }
    for (const material of pineMaterials) {
      material.envMap = isNight ? nightEnvironment : dayEnvironment;
      material.needsUpdate = true;
    }
    setNightMaterials(isNight);
    sun.target.position.copy(followTarget);
    sun.position.copy(followTarget).addScaledVector(activeLightDirection.value, 200);
    return timeMode;
  }

  return {
    setTimeOfDay,
    applyModels(models) {
      const pick = (name, axis) => (models[name] ? unitMesh(models[name], axis) : null);
      const pine = (name) => {
        const model = pick(name, 'y');
        if (!model) return null;
        const materials = Array.isArray(model.material) ? model.material : [model.material];
        for (const material of materials) {
          material.envMap = timeMode === 'night' ? nightEnvironment : dayEnvironment;
          pineMaterials.push(material);
          material.envMapIntensity = 0.1;
          material.metalness = 0;
          material.roughness = 0.95;
          material.roughnessMap = null;
          material.needsUpdate = true;
        }
        return model;
      };
      trees.userData.swap([pine('pine-a'), pine('pine-b')]);
      const rock = pick('boulder', 'xz');
      const rockFlat = pick('rock-flat', 'xz');
      const otter = pick('otter', 'y');
      for (const model of [rock, rockFlat]) {
        const materials = Array.isArray(model?.material) ? model.material : [model?.material];
        for (const material of materials) {
          if (material) nightMaterials.add(material);
        }
      }
      obstacleGroup.userData.swap({
        boulder: rock,
        'rock-flat': rockFlat,
        stump: pick('stump', 'xz'),
        log: pick('log', 'xz'),
        otter,
      });
    },
    followSun(target) {
      followTarget.copy(target);
      sun.target.position.copy(target);
      sun.position.copy(target).addScaledVector(activeLightDirection.value, 200);
    },
    createWaveOtter() {
      return obstacleGroup.userData.createWaveOtter();
    },
    updateWaveOtter(mesh, time, wave) {
      obstacleGroup.userData.updateWaveOtter(mesh, time, wave);
    },
    disposeWaveOtter(mesh) {
      obstacleGroup.userData.disposeWaveOtter(mesh);
    },
    update(time) {
      obstacleGroup.userData.update(time);
      pickupModels.update(time);
    },
    setPickupVisible(index, visible) {
      pickupModels.setVisible(index, visible);
    },
    setPickupsVisible(visible) {
      pickupModels.setAllVisible(visible);
    },
  };
}
