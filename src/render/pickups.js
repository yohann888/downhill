import * as THREE from 'three';

function labelTexture(type) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');

  if (type === 'coffee') {
    context.fillStyle = '#b9824b';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = 'rgba(255,226,180,0.18)';
    context.lineWidth = 3;
    for (let x = 8; x < canvas.width; x += 27) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + 12, canvas.height);
      context.stroke();
    }
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

function coffeeLabelTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.fillStyle = '#4a2b19';
  context.beginPath();
  context.ellipse(144, 128, 34, 51, -0.55, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#d2a06b';
  context.lineWidth = 8;
  context.beginPath();
  context.moveTo(131, 169);
  context.bezierCurveTo(157, 137, 130, 118, 157, 86);
  context.stroke();
  context.fillStyle = '#4a2b19';
  context.font = 'bold 124px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('2X', 365, 128);
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

function steamTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 256, 0, 0);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.48)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.72)');
  gradient.addColorStop(0.82, 'rgba(255,255,255,0.28)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.filter = 'blur(8px)';
  context.strokeStyle = gradient;
  context.lineCap = 'round';
  context.lineWidth = 24;
  context.beginPath();
  context.moveTo(65, 252);
  context.bezierCurveTo(34, 202, 94, 164, 58, 124);
  context.bezierCurveTo(34, 94, 86, 62, 64, 12);
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createCoffeeCup() {
  const group = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({
    color: 0xf8f6ef,
    roughness: 0.72,
    emissive: 0x706b60,
    emissiveIntensity: 0.6,
  });
  const sleeveTexture = labelTexture('coffee');
  const sleeve = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: sleeveTexture,
    emissiveMap: sleeveTexture,
    emissive: 0xffffff,
    emissiveIntensity: 0.6,
    roughness: 0.88,
  });
  const lid = new THREE.MeshStandardMaterial({
    color: 0xe8e5dc,
    roughness: 0.48,
    emissive: 0x8a8578,
    emissiveIntensity: 0.72,
  });
  const spoutOpening = new THREE.MeshStandardMaterial({
    color: 0x6e695f,
    roughness: 0.85,
    emissive: 0x181713,
    emissiveIntensity: 0.3,
  });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.163, 0.121, 0.42, 32), white);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.157, 0.139, 0.145, 32), sleeve);
  band.position.y = -0.025;
  const rolledRim = new THREE.Mesh(new THREE.TorusGeometry(0.164, 0.008, 8, 32), white);
  rolledRim.rotation.x = Math.PI / 2;
  rolledRim.position.y = 0.208;
  const lidRing = new THREE.Mesh(new THREE.CylinderGeometry(0.181, 0.17, 0.026, 32), lid);
  lidRing.position.y = 0.223;
  const lidLip = new THREE.Mesh(new THREE.TorusGeometry(0.179, 0.009, 8, 32), lid);
  lidLip.rotation.x = Math.PI / 2;
  lidLip.position.y = 0.238;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.163, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    lid,
  );
  dome.scale.y = 0.42;
  dome.position.y = 0.237;
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.04, 20), lid);
  spout.position.set(0.075, 0.3, 0);
  const opening = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.006, 16),
    spoutOpening,
  );
  opening.position.set(0.075, 0.323, 0);
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.11),
    new THREE.MeshBasicMaterial({
      map: coffeeLabelTexture(),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  label.position.set(0, -0.025, 0.157);
  group.add(cup, band, rolledRim, lidRing, lidLip, dome, spout, opening, label);

  const texture = steamTexture();
  group.userData.steamSprites = [0, 1, 2].map((index) => {
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const steam = new THREE.Sprite(material);
    steam.position.set((index - 1) * 0.055, 0.33, 0);
    steam.scale.set(0.075, 0.18, 1);
    steam.userData.phase = index / 3;
    group.add(steam);
    return steam;
  });
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
    item.userData.steamSprites = model.userData.steamSprites || [];
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
        for (const steam of item.userData.steamSprites) {
          const phase = (time * 0.55 + steam.userData.phase) % 1;
          steam.position.y = 0.33 + phase * 0.16;
          steam.material.opacity = Math.sin(Math.PI * phase) * 0.62;
          steam.scale.set(0.075 + phase * 0.025, 0.18 + phase * 0.08, 1);
        }
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
