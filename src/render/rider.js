import * as THREE from 'three';

const WHEEL_R = 0.36;
const HALF_BASE = 0.575;

function bar(material, from, to, thickness = 0.045) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const length = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(thickness, thickness, length, 6), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}

function wheel(tire, rim) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.04, 0.045, 8, 28).rotateY(Math.PI / 2), tire));
  for (let i = 0; i < 4; i += 1) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.01, WHEEL_R * 1.8, 0.012), rim);
    spoke.rotation.x = (i * Math.PI) / 4;
    g.add(spoke);
  }
  return g;
}

export function createRiderModel() {
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xff6a2b, roughness: 0.35, metalness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.6 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const jerseyMat = new THREE.MeshStandardMaterial({ color: 0x1c8c8c, roughness: 0.8 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.9 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const assetHolder = new THREE.Group();
  assetHolder.visible = false;
  root.add(assetHolder);

  const rearWheel = wheel(tireMat, darkMat);
  rearWheel.position.set(0, WHEEL_R, HALF_BASE);
  body.add(rearWheel);

  const steerPivot = new THREE.Group();
  steerPivot.position.set(0, 0, -HALF_BASE + 0.12);
  body.add(steerPivot);
  const frontWheel = wheel(tireMat, darkMat);
  frontWheel.position.set(0, WHEEL_R, -0.12);
  steerPivot.add(frontWheel);
  steerPivot.add(bar(darkMat, [0, WHEEL_R, -0.12], [0, 1.0, 0.08], 0.03));
  steerPivot.add(bar(darkMat, [-0.38, 1.04, 0.1], [0.38, 1.04, 0.1], 0.018));

  const bb = [0, 0.33, 0.05];
  body.add(bar(frameMat, [0, WHEEL_R, HALF_BASE], bb));
  body.add(bar(frameMat, bb, [0, 0.88, -0.36]));
  body.add(bar(frameMat, bb, [0, 0.82, 0.18]));
  body.add(bar(frameMat, [0, 0.82, 0.18], [0, 0.9, -0.38]));
  body.add(bar(frameMat, [0, WHEEL_R, HALF_BASE], [0, 0.82, 0.18], 0.03));
  body.add(bar(darkMat, [0, 0.82, 0.18], [0, 0.95, 0.24], 0.02));
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.26), darkMat);
  saddle.position.set(0, 0.97, 0.26);
  body.add(saddle);

  const crank = new THREE.Group();
  crank.position.set(...bb);
  crank.add(bar(darkMat, [0.08, 0, 0], [0.08, -0.17, 0], 0.015));
  crank.add(bar(darkMat, [-0.08, 0, 0], [-0.08, 0.17, 0], 0.015));
  body.add(crank);

  const rider = new THREE.Group();
  body.add(rider);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), jerseyMat);
  torso.position.set(0, 1.32, 0.02);
  torso.rotation.x = -1.0;
  rider.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), helmetMat);
  head.position.set(0, 1.58, -0.28);
  head.scale.set(1, 0.9, 1.25);
  rider.add(head);
  for (const side of [-1, 1]) {
    rider.add(bar(jerseyMat, [side * 0.18, 1.45, -0.12], [side * 0.34, 1.06, 0.06], 0.05));
    rider.add(bar(pantsMat, [side * 0.12, 1.12, 0.22], [side * 0.14, 0.72, -0.08], 0.07));
    rider.add(bar(pantsMat, [side * 0.14, 0.72, -0.08], [side * 0.11, 0.36, 0.05], 0.055));
  }

  root.traverse((m) => { if (m.isMesh) m.castShadow = true; });

  let pitch = 0;
  let cadence = 0;
  let assetBaseY = 0;
  let assetBob = 0;
  let assetShift = 0;
  let assetBones = null;
  let boneMotion = { spine: 0, spine01: 0, hips: 0 };

  function rememberBones(scene) {
    const bones = {};
    scene.traverse((object) => {
      if (!object.isBone) return;
      if (!Number.isFinite(object.position.x)) object.position.x = 0;
      if (!Number.isFinite(object.position.y)) object.position.y = 0;
      if (!Number.isFinite(object.position.z)) object.position.z = 0;
      if (![object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w].every(Number.isFinite)) {
        object.quaternion.identity();
      }
      bones[object.name] = {
        object,
        rotation: object.rotation.clone(),
        position: object.position.clone(),
      };
    });
    return bones;
  }

  function setGlb(gltf) {
    if (!gltf?.scene) return false;
    assetHolder.clear();
    const scene = gltf.scene;
    assetHolder.add(scene);
    assetHolder.scale.setScalar(1);
    assetHolder.position.set(0, 0, 0);
    assetHolder.rotation.set(0, 0, 0);
    let boundsObject = scene;
    scene.traverse((object) => {
      if (object.isSkinnedMesh && boundsObject === scene) boundsObject = object;
    });
    assetBones = rememberBones(scene);
    const rootPosition = root.position.clone();
    const rootRotation = root.rotation.clone();
    const rootScale = root.scale.clone();
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.setScalar(1);
    root.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    boundsObject.skeleton?.update();
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    if (size.y <= 1e-4) {
      root.position.copy(rootPosition);
      root.rotation.copy(rootRotation);
      root.scale.copy(rootScale);
      root.updateMatrixWorld(true);
      assetHolder.clear();
      return false;
    }
    const scale = 1.7 / size.y;
    assetHolder.scale.setScalar(scale);
    assetBaseY = -box.min.y * scale;
    assetHolder.position.set(0, assetBaseY, 0);
    assetHolder.rotation.set(0, Math.PI, 0);
    root.position.copy(rootPosition);
    root.rotation.copy(rootRotation);
    root.scale.copy(rootScale);
    root.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    boundsObject.skeleton?.update();
    boneMotion = { spine: 0, spine01: 0, hips: 0 };
    scene.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    body.visible = false;
    assetHolder.visible = true;
    return true;
  }

  return {
    root,
    setGlb,
    update(bike, input, grade, dt) {
      const k = 1 - Math.exp(-10 * dt);
      const targetPitch = bike.airborne
        ? Math.atan2(bike.vy, Math.max(bike.v, 1)) * 0.6
        : Math.atan(grade);
      pitch += (targetPitch - pitch) * k;
      root.rotation.set(pitch, -bike.heading, -bike.lean, 'YXZ');
      const spin = (bike.v / WHEEL_R) * dt;
      rearWheel.rotation.x -= spin;
      frontWheel.rotation.x -= spin;
      steerPivot.rotation.y = -bike.steer;
      if (input.throttle && !bike.airborne) cadence += dt * Math.min(9, 3 + bike.v * 0.5);
      crank.rotation.x = -cadence;
      const crouch = bike.airborne ? -0.1 : input.throttle ? -0.02 * Math.sin(cadence * 2) : -0.05;
      const shift = bike.brake * 0.12;
      rider.position.y += (crouch - rider.position.y) * k;
      rider.position.z += (shift - rider.position.z) * k;
      rider.rotation.z = Math.sin(cadence) * 0.04 * (input.throttle ? 1 : 0);
      if (assetHolder.visible && assetBones) {
        assetBob += (crouch - assetBob) * k;
        assetShift += (shift - assetShift) * k;
        assetHolder.position.y = assetBaseY + assetBob;
        assetHolder.position.z = assetShift;

        const speedDrive = Math.min(1, bike.v / 16);
        const targetSpine = input.brake
          ? -0.15
          : input.throttle
            ? 0.05 + speedDrive * 0.2
            : speedDrive * 0.05;
        const targetHips = (input.steer ?? 0) * 0.04;
        boneMotion.spine += (targetSpine - boneMotion.spine) * k;
        boneMotion.spine01 += (targetSpine * 0.7 - boneMotion.spine01) * k;
        boneMotion.hips += (targetHips - boneMotion.hips) * k;

        const spine = assetBones.Spine;
        const spine01 = assetBones.Spine01;
        const head = assetBones.Head;
        const hips = assetBones.Hips;
        if (spine) spine.object.rotation.x = (Number.isFinite(spine.rotation.x) ? spine.rotation.x : 0) + boneMotion.spine * 0.55;
        if (spine01) spine01.object.rotation.x = (Number.isFinite(spine01.rotation.x) ? spine01.rotation.x : 0) + boneMotion.spine01 * 0.45;
        if (head) head.object.rotation.x = (Number.isFinite(head.rotation.x) ? head.rotation.x : 0) - boneMotion.spine01 * 0.7;
        if (hips) hips.object.position.x = (Number.isFinite(hips.position.x) ? hips.position.x : 0) + boneMotion.hips;
      }
    },
  };
}
