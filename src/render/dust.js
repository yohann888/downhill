import * as THREE from 'three';

const COUNT = 400;

export function createDust(scene) {
  const positions = new Float32Array(COUNT * 3);
  const velocities = new Float32Array(COUNT * 3);
  const life = new Float32Array(COUNT);
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
  for (let i = 0; i < COUNT; i += 1) positions[i * 3 + 1] = -1e5;

  return {
    update(bike, riding, dt) {
      const grounded = riding && !bike.airborne && !bike.crashed;
      const rate = grounded ? Math.max(0, bike.v - 4) * 3 + (bike.slipping ? 60 : 0) + (bike.brake > 0.5 && bike.v > 5 ? 40 : 0) : 0;
      carry += rate * dt;
      const fx = Math.sin(bike.heading);
      const fz = -Math.cos(bike.heading);
      while (carry >= 1) {
        carry -= 1;
        const i = cursor;
        cursor = (cursor + 1) % COUNT;
        positions[i * 3] = bike.x - fx * 0.6 + (Math.random() - 0.5) * 0.3;
        positions[i * 3 + 1] = bike.y + 0.08;
        positions[i * 3 + 2] = bike.z - fz * 0.6 + (Math.random() - 0.5) * 0.3;
        velocities[i * 3] = -fx * bike.v * 0.15 + (Math.random() - 0.5) * 1.2;
        velocities[i * 3 + 1] = 0.4 + Math.random() * 0.9;
        velocities[i * 3 + 2] = -fz * bike.v * 0.15 + (Math.random() - 0.5) * 1.2;
        life[i] = 0.9 + Math.random() * 0.6;
      }
      for (let i = 0; i < COUNT; i += 1) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) { positions[i * 3 + 1] = -1e5; continue; }
        const drag = Math.exp(-2.5 * dt);
        velocities[i * 3] *= drag;
        velocities[i * 3 + 1] = velocities[i * 3 + 1] * drag - 0.4 * dt;
        velocities[i * 3 + 2] *= drag;
        positions[i * 3] += velocities[i * 3] * dt;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      }
      geometry.attributes.position.needsUpdate = true;
    },
  };
}
