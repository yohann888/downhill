import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { createRandom, createValueNoise } from '../world/noise.js';
import { crossProfile } from '../world/terrain.js';
import { unitMesh } from './assets.js';
import { createGroundMaterial, loadGroundTextures } from './ground.js';

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

function acrossOffsets() {
  const offsets = [];
  for (let d = -260; d < -110; d += 10) offsets.push(d);
  for (let d = -110; d < -14; d += 4) offsets.push(d);
  for (let d = -14; d <= 14; d += 0.5) offsets.push(d);
  for (let d = 18; d <= 110; d += 4) offsets.push(d);
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
      splat[q] = 1 - smoothstep(hw - 0.5 + (n - 0.5) * 0.8, hw + 0.9 + (n - 0.5) * 1.2, ad);
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
  const segments = 260;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, -900);
  const { farHeight, lakeY } = createFarHeight(terrain);
  const detail = createValueNoise(29);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const splat = new Float32Array(pos.count * 2);
  const forest = new THREE.Color(0.42, 0.55, 0.36);
  const stone = new THREE.Color(1, 1, 1);
  const snow = new THREE.Color(2.4, 2.45, 2.6);
  const color = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const far = farHeight(x, z);
    const y = far.y - 45 * (1 - smoothstep(210, 255, far.distance));
    pos.setY(i, y);
    const rel = y - lakeY;
    const stoneW = smoothstep(140, 260, rel);
    const snowW = smoothstep(290, 360, rel + detail(x / 40, z / 40) * 40);
    color.copy(forest).lerp(stone, stoneW).lerp(snow, snowW);
    splat[i * 2 + 1] = Math.max(stoneW, snowW);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('splat', new THREE.BufferAttribute(splat, 2));
  geometry.computeVertexNormals();
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
  const placements = obstacles
    .filter((o) => o.type === 'tree')
    .map((o) => ({ x: o.x, z: o.z, scale: 0.9 + random() * 0.5 }));
  for (let s = -30; s <= terrain.courseLength + 50; s += 1.6) {
    const z = -s;
    for (const side of [-1, 1]) {
      if (random() > 0.85) continue;
      const hw = terrain.halfWidth(z);
      const d = hw + 9 + Math.pow(random(), 1.6) * 95;
      placements.push({
        x: terrain.centerX(z) + side * d,
        z: z + (random() - 0.5) * 1.5,
        scale: 0.8 + random() * 0.9,
      });
    }
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
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2);
    scale.setScalar(tree.scale);
    matrix.compose(position, quat, scale);
    trunks.setMatrixAt(i, matrix);
    foliage.setMatrixAt(i, matrix);
    color.setHSL(0.27 + random() * 0.07, 0.45, 0.16 + random() * 0.08);
    foliage.setColorAt(i, color);
  });
  trunks.castShadow = true;
  foliage.castShadow = true;
  foliage.receiveShadow = true;
  const group = new THREE.Group();
  group.add(trunks, foliage);
  const yaw = placements.map(() => random() * Math.PI * 2);
  group.userData.swap = (variants) => {
    const usable = variants.filter(Boolean);
    if (!usable.length) return;
    trunks.visible = false;
    foliage.visible = false;
    usable.forEach((variant, v) => {
      const mine = placements.filter((_, i) => i % usable.length === v);
      const mesh = new THREE.InstancedMesh(variant.geometry, variant.material, mine.length);
      mine.forEach((tree, i) => {
        position.set(tree.x, terrain.heightAt(tree.x, tree.z), tree.z);
        quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw[i]);
        scale.setScalar(10);
        matrix.compose(position, quat, scale);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    });
  };
  return group;
}

function buildObstacles(terrain, obstacles) {
  const group = new THREE.Group();
  const movingMeshes = [];
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x86827a, roughness: 0.9, flatShading: true });
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
  };
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

export function buildWorld(scene, renderer, terrain, obstacles) {
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
  scene.environment = pmrem.fromScene(envScene).texture;
  scene.environmentIntensity = 0.55;
  const pineMaterials = [];
  new THREE.TextureLoader().load('./assets/textures/sky.webp', (skyTexture) => {
    skyTexture.mapping = THREE.EquirectangularReflectionMapping;
    skyTexture.colorSpace = THREE.SRGBColorSpace;
    scene.background = skyTexture;
    scene.backgroundRotation.y = SKY_ROTATION;
    scene.environmentRotation.y = SKY_ROTATION;
    scene.environment = pmrem.fromEquirectangular(skyTexture).texture;
    for (const material of pineMaterials) {
      material.envMap = scene.environment;
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
  scene.add(buildCourseMesh(terrain, groundTextures));
  scene.add(buildRangeMesh(terrain, groundTextures));
  const trees = buildTrees(terrain, obstacles);
  const obstacleGroup = buildObstacles(terrain, obstacles);
  scene.add(trees, obstacleGroup);
  scene.add(buildMarkers(terrain));

  return {
    applyModels(models) {
      const pick = (name, axis) => (models[name] ? unitMesh(models[name], axis) : null);
      const pine = (name) => {
        const model = pick(name, 'y');
        if (!model) return null;
        const materials = Array.isArray(model.material) ? model.material : [model.material];
        for (const material of materials) {
          material.envMap = scene.environment;
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
      obstacleGroup.userData.swap({
        boulder: rock,
        'rock-flat': pick('rock-flat', 'xz'),
        stump: pick('stump', 'xz'),
        log: pick('log', 'xz'),
        otter: pick('otter', 'y'),
      });
    },
    followSun(target) {
      sun.target.position.copy(target);
      sun.position.copy(target).addScaledVector(SUN_DIRECTION, 200);
    },
    update(time) {
      obstacleGroup.userData.update(time);
    },
  };
}
