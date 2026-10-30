import * as THREE from 'three';
import { G } from '../physics/constants.js';

const DUST_COUNT = 400;
const GRAVEL_COUNT = 300;
const LEAF_COUNT = 200;
const LEAF_BURST_SIZE = 40;
const LEAF_LIFETIME = 1.5;
const SKID_MARK_COUNT = 400;
const SKID_MARK_LIFETIME = 8;
const SKID_MARK_INTERVAL = 0.05;

const clamp01 = (value) => Math.max(0, Math.min(1, value));

export function createDust(scene, terrain) {
  const positions = new Float32Array(DUST_COUNT * 3);
  const velocities = new Float32Array(DUST_COUNT * 3);
  const life = new Float32Array(DUST_COUNT);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const material = new THREE.PointsMaterial({
    map: new THREE.CanvasTexture(canvas),
    color: 0xb08a63,
    size: 0.35,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  let cursor = 0;
  let carry = 0;
  for (let i = 0; i < DUST_COUNT; i += 1) positions[i * 3 + 1] = -1e5;

  const gravelGeometry = new THREE.DodecahedronGeometry(1, 0);
  const gravelMaterial = new THREE.MeshStandardMaterial({
    color: 0x5a4a3a,
    roughness: 1,
  });
  const gravel = new THREE.InstancedMesh(
    gravelGeometry,
    gravelMaterial,
    GRAVEL_COUNT,
  );
  gravel.frustumCulled = false;
  scene.add(gravel);
  const gravelParticles = Array.from({ length: GRAVEL_COUNT }, () => ({
    age: -1,
    radius: 0,
    x: 0,
    y: -1e5,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    bounced: false,
    settled: false,
  }));
  const gravelDummy = new THREE.Object3D();
  for (let i = 0; i < GRAVEL_COUNT; i += 1) {
    gravelDummy.position.set(0, -1e5, 0);
    gravelDummy.scale.setScalar(0.03);
    gravelDummy.updateMatrix();
    gravel.setMatrixAt(i, gravelDummy.matrix);
  }
  gravel.instanceMatrix.needsUpdate = true;

  const leafGeometry = new THREE.PlaneGeometry(0.16, 0.1);
  const leafOpacity = new THREE.InstancedBufferAttribute(
    new Float32Array(LEAF_COUNT),
    1,
  );
  leafGeometry.setAttribute('instanceLeafOpacity', leafOpacity);
  const leafMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  leafMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float instanceLeafOpacity;\nvarying float vInstanceLeafOpacity;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvInstanceLeafOpacity = instanceLeafOpacity;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vInstanceLeafOpacity;',
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.a *= vInstanceLeafOpacity;',
      );
  };
  leafMaterial.customProgramCacheKey = () => 'leaf-opacity';
  const leaves = new THREE.InstancedMesh(
    leafGeometry,
    leafMaterial,
    LEAF_COUNT,
  );
  leaves.frustumCulled = false;
  scene.add(leaves);
  const leafParticles = Array.from({ length: LEAF_COUNT }, () => ({
    age: -1,
    x: 0,
    y: -1e5,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    rotation: 0,
    spin: 0,
  }));
  const leafDummy = new THREE.Object3D();
  const leafColor = new THREE.Color();
  for (let i = 0; i < LEAF_COUNT; i += 1) {
    leafOpacity.array[i] = 0;
    leafColor.set(i % 3 === 0 ? 0x6d4d2e : 0x3d7f3e);
    leaves.setColorAt(i, leafColor);
    leafDummy.position.set(0, -1e5, 0);
    leafDummy.scale.setScalar(0.01);
    leafDummy.updateMatrix();
    leaves.setMatrixAt(i, leafDummy.matrix);
  }
  leaves.instanceColor.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  leafOpacity.needsUpdate = true;

  const skidMarkGeometry = new THREE.PlaneGeometry(0.09, 0.55);
  const skidMarkOpacity = new THREE.InstancedBufferAttribute(
    new Float32Array(SKID_MARK_COUNT),
    1,
  );
  skidMarkGeometry.setAttribute('instanceOpacity', skidMarkOpacity);
  const skidMarkMaterial = new THREE.MeshBasicMaterial({
    color: 0x211a14,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  skidMarkMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float instanceOpacity;\nvarying float vInstanceOpacity;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvInstanceOpacity = instanceOpacity;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vInstanceOpacity;',
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.a *= vInstanceOpacity;',
      );
  };
  skidMarkMaterial.customProgramCacheKey = () => 'skid-mark-opacity';
  const skidMarks = new THREE.InstancedMesh(
    skidMarkGeometry,
    skidMarkMaterial,
    SKID_MARK_COUNT,
  );
  skidMarks.frustumCulled = false;
  scene.add(skidMarks);
  const skidMarkAges = new Float32Array(SKID_MARK_COUNT);
  skidMarkAges.fill(-1);
  const skidMarkDummy = new THREE.Object3D();
  for (let i = 0; i < SKID_MARK_COUNT; i += 1) {
    skidMarkDummy.position.set(0, -1e5, 0);
    skidMarkDummy.updateMatrix();
    skidMarks.setMatrixAt(i, skidMarkDummy.matrix);
  }
  skidMarks.instanceMatrix.needsUpdate = true;
  const markNormal = new THREE.Vector3();
  const markForward = new THREE.Vector3();
  const markRight = new THREE.Vector3();
  const markBasis = new THREE.Matrix4();
  let gravelCursor = 0;
  let gravelCarry = 0;
  let leafCursor = 0;
  let skidMarkCursor = 0;
  let skidMarkCarry = 0;

  return {
    leafBurst(hit) {
      const groundY = terrain.heightAt(hit.x, hit.z);
      for (let count = 0; count < LEAF_BURST_SIZE; count += 1) {
        const index = leafCursor;
        leafCursor = (leafCursor + 1) % LEAF_COUNT;
        const particle = leafParticles[index];
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 2.5;
        particle.age = 0;
        particle.x = hit.x + (Math.random() - 0.5) * 0.5;
        particle.y = groundY + 0.5 + Math.random() * 2;
        particle.z = hit.z + (Math.random() - 0.5) * 0.5;
        particle.vx = Math.cos(angle) * speed;
        particle.vy = 1 + Math.random() * 2;
        particle.vz = Math.sin(angle) * speed;
        particle.rotation = Math.random() * Math.PI * 2;
        particle.spin = (Math.random() - 0.5) * 14;
        leafColor.set(Math.random() < 0.72 ? 0x3d7f3e : 0x6d4d2e);
        leaves.setColorAt(index, leafColor);
        leafOpacity.array[index] = 1;
        leafDummy.position.set(particle.x, particle.y, particle.z);
        leafDummy.rotation.set(
          (Math.random() - 0.5) * 1.2,
          (Math.random() - 0.5) * 1.2,
          particle.rotation,
        );
        leafDummy.scale.setScalar(0.75 + Math.random() * 0.5);
        leafDummy.updateMatrix();
        leaves.setMatrixAt(index, leafDummy.matrix);
      }
      leaves.instanceColor.needsUpdate = true;
      leaves.instanceMatrix.needsUpdate = true;
      leafOpacity.needsUpdate = true;
    },
    update(bike, riding, dt) {
      const grounded = riding && !bike.airborne && !bike.crashed;
      const skid = grounded ? clamp01(bike.skid || 0) : 0;
      const rate = grounded ? Math.max(0, bike.v - 4) * 3 + skid * 100 : 0;
      carry += rate * dt;
      const fx = Math.sin(bike.heading);
      const fz = -Math.cos(bike.heading);
      while (carry >= 1) {
        carry -= 1;
        const i = cursor;
        cursor = (cursor + 1) % DUST_COUNT;
        positions[i * 3] = bike.x - fx * 0.6 + (Math.random() - 0.5) * 0.3;
        positions[i * 3 + 1] = bike.y + 0.08;
        positions[i * 3 + 2] = bike.z - fz * 0.6 + (Math.random() - 0.5) * 0.3;
        velocities[i * 3] = -fx * bike.v * 0.15 + (Math.random() - 0.5) * 1.2;
        velocities[i * 3 + 1] = 0.4 + Math.random() * 0.9;
        velocities[i * 3 + 2] = -fz * bike.v * 0.15 + (Math.random() - 0.5) * 1.2;
        life[i] = 0.9 + Math.random() * 0.6;
      }
      for (let i = 0; i < DUST_COUNT; i += 1) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) {
          positions[i * 3 + 1] = -1e5;
          continue;
        }
        const drag = Math.exp(-2.5 * dt);
        velocities[i * 3] *= drag;
        velocities[i * 3 + 1] = velocities[i * 3 + 1] * drag - 0.4 * dt;
        velocities[i * 3 + 2] *= drag;
        positions[i * 3] += velocities[i * 3] * dt;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      }
      geometry.attributes.position.needsUpdate = true;

      let gravelChanged = false;
      for (let i = 0; i < GRAVEL_COUNT; i += 1) {
        const particle = gravelParticles[i];
        if (particle.age < 0) continue;
        particle.age += dt;
        if (particle.age >= 0.8) {
          particle.age = -1;
          particle.y = -1e5;
          gravelDummy.position.set(particle.x, particle.y, particle.z);
          gravelDummy.scale.setScalar(0.03);
          gravelDummy.updateMatrix();
          gravel.setMatrixAt(i, gravelDummy.matrix);
          gravelChanged = true;
          continue;
        }
        if (!particle.settled) {
          const drag = Math.exp(-0.12 * dt);
          particle.vx *= drag;
          particle.vy = particle.vy * drag - G * dt;
          particle.vz *= drag;
          particle.x += particle.vx * dt;
          particle.y += particle.vy * dt;
          particle.z += particle.vz * dt;
          const floor = terrain.heightAt(particle.x, particle.z) + particle.radius;
          if (particle.y <= floor) {
            particle.y = floor;
            if (!particle.bounced && particle.vy < -1) {
              particle.vy *= -0.24;
              particle.vx *= 0.55;
              particle.vz *= 0.55;
              particle.bounced = true;
            } else {
              particle.vx = 0;
              particle.vy = 0;
              particle.vz = 0;
              particle.settled = true;
            }
          }
          gravelChanged = true;
        }
        gravelDummy.position.set(particle.x, particle.y, particle.z);
        gravelDummy.scale.setScalar(particle.radius);
        gravelDummy.updateMatrix();
        gravel.setMatrixAt(i, gravelDummy.matrix);
      }

      if (grounded && skid > 0) {
        gravelCarry += skid * 220 * dt;
        const rearX = bike.x - fx * 0.575;
        const rearZ = bike.z - fz * 0.575;
        const groundY = terrain.heightAt(rearX, rearZ);
        const rightX = Math.cos(bike.heading);
        const rightZ = Math.sin(bike.heading);
        const slideSign = Math.sign(bike.steer);
        while (gravelCarry >= 1) {
          gravelCarry -= 1;
          const index = gravelCursor;
          const particle = gravelParticles[index];
          gravelCursor = (index + 1) % GRAVEL_COUNT;
          const horizontalSpeed = 2 + Math.random() * 3;
          const angle = 0.35 + Math.random() * 0.5;
          const sideSpeed = slideSign
            ? horizontalSpeed * Math.sin(angle)
            : 0;
          const backSpeed = slideSign
            ? horizontalSpeed * Math.cos(angle)
            : horizontalSpeed;
          particle.age = 0;
          particle.radius = 0.025 + Math.random() * 0.02;
          particle.x = rearX;
          particle.y = groundY + particle.radius;
          particle.z = rearZ;
          particle.vx = -fx * backSpeed - rightX * slideSign * sideSpeed;
          particle.vy = 1 + Math.random() * 2;
          particle.vz = -fz * backSpeed - rightZ * slideSign * sideSpeed;
          particle.bounced = false;
          particle.settled = false;
          gravelDummy.position.set(particle.x, particle.y, particle.z);
          gravelDummy.scale.setScalar(particle.radius);
          gravelDummy.updateMatrix();
          gravel.setMatrixAt(index, gravelDummy.matrix);
          gravelChanged = true;
        }
      } else {
        gravelCarry = 0;
      }
      if (gravelChanged) gravel.instanceMatrix.needsUpdate = true;

      let leavesChanged = false;
      for (let i = 0; i < LEAF_COUNT; i += 1) {
        const particle = leafParticles[i];
        if (particle.age < 0) continue;
        particle.age += dt;
        if (particle.age >= LEAF_LIFETIME) {
          particle.age = -1;
          leafOpacity.array[i] = 0;
          leafDummy.position.set(0, -1e5, 0);
          leafDummy.scale.setScalar(0.01);
          leafDummy.updateMatrix();
          leaves.setMatrixAt(i, leafDummy.matrix);
          leavesChanged = true;
          continue;
        }
        const drag = Math.exp(-3.5 * dt);
        particle.vx *= drag;
        particle.vy = particle.vy * drag - G * dt;
        particle.vz *= drag;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.z += particle.vz * dt;
        particle.rotation += particle.spin * dt;
        leafOpacity.array[i] = 1 - particle.age / LEAF_LIFETIME;
        leafDummy.position.set(particle.x, particle.y, particle.z);
        leafDummy.rotation.set(0.4, -0.3, particle.rotation);
        leafDummy.scale.setScalar(0.75 + 0.5 * leafOpacity.array[i]);
        leafDummy.updateMatrix();
        leaves.setMatrixAt(i, leafDummy.matrix);
        leavesChanged = true;
      }
      if (leavesChanged) {
        leaves.instanceMatrix.needsUpdate = true;
        leafOpacity.needsUpdate = true;
      }

      let opacityChanged = false;
      let markMatrixChanged = false;
      for (let i = 0; i < SKID_MARK_COUNT; i += 1) {
        if (skidMarkAges[i] < 0) continue;
        skidMarkAges[i] += dt;
        skidMarkOpacity.array[i] = Math.max(
          0,
          1 - skidMarkAges[i] / SKID_MARK_LIFETIME,
        );
        if (skidMarkAges[i] >= SKID_MARK_LIFETIME) {
          skidMarkAges[i] = -1;
          skidMarkOpacity.array[i] = 0;
        }
        opacityChanged = true;
      }

      if (grounded && skid > 0.35) {
        skidMarkCarry += dt;
        while (skidMarkCarry >= SKID_MARK_INTERVAL) {
          skidMarkCarry -= SKID_MARK_INTERVAL;
          const index = skidMarkCursor;
          skidMarkCursor = (skidMarkCursor + 1) % SKID_MARK_COUNT;
          const rearX = bike.x - fx * 0.575;
          const rearZ = bike.z - fz * 0.575;
          const sample = 0.1;
          const gradientX =
            (terrain.heightAt(rearX + sample, rearZ)
              - terrain.heightAt(rearX - sample, rearZ)) /
            (2 * sample);
          const gradientZ =
            (terrain.heightAt(rearX, rearZ + sample)
              - terrain.heightAt(rearX, rearZ - sample)) /
            (2 * sample);
          markNormal.set(-gradientX, 1, -gradientZ).normalize();
          const grade =
            (terrain.heightAt(rearX + fx * sample, rearZ + fz * sample)
              - terrain.heightAt(rearX - fx * sample, rearZ - fz * sample)) /
            (2 * sample);
          markForward.set(fx, grade, fz).normalize();
          markForward.addScaledVector(
            markNormal,
            -markForward.dot(markNormal),
          ).normalize();
          markRight.crossVectors(markForward, markNormal).normalize();
          markBasis.makeBasis(markRight, markForward, markNormal);
          skidMarkDummy.quaternion.setFromRotationMatrix(markBasis);
          skidMarkDummy.position
            .set(rearX, terrain.heightAt(rearX, rearZ), rearZ)
            .addScaledVector(markNormal, 0.02);
          skidMarkDummy.updateMatrix();
          skidMarks.setMatrixAt(index, skidMarkDummy.matrix);
          skidMarkAges[index] = 0;
          skidMarkOpacity.array[index] = 1;
          opacityChanged = true;
          markMatrixChanged = true;
        }
      } else {
        skidMarkCarry = 0;
      }
      if (opacityChanged) skidMarkOpacity.needsUpdate = true;
      if (markMatrixChanged) skidMarks.instanceMatrix.needsUpdate = true;
    },
  };
}
