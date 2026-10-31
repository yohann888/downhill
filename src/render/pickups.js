import * as THREE from 'three';

function labelTexture(type) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');

  if (type === 'coffee') {
    context.fillStyle = '#9a5b2d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#f8c84b';
    context.font = 'bold 112px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('2X', canvas.width / 2, canvas.height / 2);
  } else {
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#ff38ae');
    gradient.addColorStop(0.5, '#8425cf');
    gradient.addColorStop(1, '#30eaff');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#fff';
    context.font = 'bold 92px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('⚡', canvas.width / 2, 105);
    context.font = 'bold 28px sans-serif';
    context.fillText('OTTER FUEL', canvas.width / 2, 185);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function createCoffeeCup() {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f0e8, roughness: 0.55 });
  const sleeve = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: labelTexture('coffee'),
    roughness: 0.82,
  });
  const lid = new THREE.MeshStandardMaterial({ color: 0x24202c, roughness: 0.45 });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.35, 24), white);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.104, 0.118, 0.12, 24), sleeve);
  band.position.y = -0.015;
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.035, 24), lid);
  cover.position.y = 0.19;
  group.add(cup, band, cover);
  return group;
}

function createEnergyCan() {
  const group = new THREE.Group();
  const texture = labelTexture('energy');
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: texture,
    emissive: 0x35104d,
    emissiveMap: texture,
    emissiveIntensity: 0.65,
    metalness: 0.72,
    roughness: 0.27,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: 0xc9d8e0,
    metalness: 0.85,
    roughness: 0.2,
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 24), bodyMaterial);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.064, 0.064, 0.018, 24), metal);
  top.position.y = 0.205;
  group.add(body, top);
  return group;
}

export function buildPickups(terrain, pickups) {
  const group = new THREE.Group();
  const spriteTexture = glowTexture();
  const entries = pickups.map((pickup, index) => {
    const item = new THREE.Group();
    const scale = 2.5;
    const model = pickup.type === 'coffee' ? createCoffeeCup() : createEnergyCan();
    model.scale.setScalar(scale);
    const glowMaterial = new THREE.SpriteMaterial({
      map: spriteTexture,
      color: pickup.type === 'coffee' ? 0xffc44f : 0x3beaff,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const glow = new THREE.Sprite(glowMaterial);
    glow.scale.set(1.65, 1.65, 1);
    item.add(model, glow);
    item.name = `pickup-${pickup.type}-${index}`;
    item.position.set(pickup.x, terrain.heightAt(pickup.x, pickup.z) + 1, pickup.z);
    item.userData.baseY = item.position.y;
    item.userData.phase = index * 1.7;
    item.visible = !pickup.taken;
    group.add(item);
    return item;
  });

  return {
    group,
    update(time) {
      for (const item of entries) {
        item.rotation.y = time * 1.2 + item.userData.phase;
        item.position.y =
          item.userData.baseY + Math.sin(time * 2.2 + item.userData.phase) * 0.08;
      }
    },
    setVisible(index, visible) {
      if (entries[index]) entries[index].visible = visible;
    },
    setAllVisible(visible) {
      for (const item of entries) item.visible = visible;
    },
  };
}
