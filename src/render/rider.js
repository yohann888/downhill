import * as THREE from 'three';

const WHEEL_R = 0.36;
const HALF_BASE = 0.575;
const PEDAL_R = 0.17;

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

function spring(value = 0) {
  return { value, velocity: 0 };
}

function stepSpring(state, target, dt, omega = 12) {
  const delta = state.value - target;
  const combined = state.velocity + omega * delta;
  const decay = Math.exp(-omega * Math.max(0, dt));
  state.value = target + (delta + combined * dt) * decay;
  state.velocity = (state.velocity - omega * combined * dt) * decay;
  return state.value;
}

function vectorSpring() {
  return { x: spring(), y: spring(), z: spring() };
}

function stepVectorSpring(state, target, dt, omega = 14) {
  return new THREE.Vector3(
    stepSpring(state.x, target.x, dt, omega),
    stepSpring(state.y, target.y, dt, omega),
    stepSpring(state.z, target.z, dt, omega),
  );
}

function normalizedBoneName(name) {
  return name.replace(/^mixamorig:/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function getRiderBones(scene) {
  const byName = new Map();
  scene.traverse((object) => {
    if (object.isBone) byName.set(normalizedBoneName(object.name), object);
  });
  const find = (...names) => names.map((name) => byName.get(name.toLowerCase())).find(Boolean) || null;
  const bones = {
    hips: find('hips'),
    spine: find('spine'),
    spine1: find('spine1', 'spine01'),
    spine2: find('spine2', 'spine02'),
    neck: find('neck'),
    head: find('head'),
    leftShoulder: find('leftshoulder'),
    rightShoulder: find('rightshoulder'),
    leftArm: find('leftarm'),
    rightArm: find('rightarm'),
    leftForeArm: find('leftforearm'),
    rightForeArm: find('rightforearm'),
    leftHand: find('lefthand'),
    rightHand: find('righthand'),
    leftUpLeg: find('leftupleg'),
    rightUpLeg: find('rightupleg'),
    leftLeg: find('leftleg'),
    rightLeg: find('rightleg'),
    leftFoot: find('leftfoot'),
    rightFoot: find('rightfoot'),
  };
  const bind = new Map();
  for (const bone of byName.values()) {
    bind.set(bone, { position: bone.position.clone(), quaternion: bone.quaternion.clone() });
  }
  return { bones, bind };
}

function boneWorldPosition(bone) {
  return bone.getWorldPosition(new THREE.Vector3());
}

function makeChain(upper, lower, end) {
  if (!upper || !lower || !end) return null;
  const firstLength = boneWorldPosition(upper).distanceTo(boneWorldPosition(lower));
  const secondLength = boneWorldPosition(lower).distanceTo(boneWorldPosition(end));
  if (firstLength < 1e-4 || secondLength < 1e-4) return null;
  return { upper, lower, end, firstLength, secondLength };
}

function setWorldRotation(bone, desiredWorldQuaternion) {
  if (!bone.parent) return;
  const parentQuaternion = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parentQuaternion.multiply(desiredWorldQuaternion));
}

function rotateBoneToward(bone, child, desiredDirection) {
  if (!bone || !child || desiredDirection.lengthSq() < 1e-10) return;
  const start = boneWorldPosition(bone);
  const current = boneWorldPosition(child).sub(start).normalize();
  if (current.lengthSq() < 1e-10) return;
  const delta = new THREE.Quaternion().setFromUnitVectors(current, desiredDirection.clone().normalize());
  const worldQuaternion = bone.getWorldQuaternion(new THREE.Quaternion());
  setWorldRotation(bone, delta.multiply(worldQuaternion));
}

function rotateBoneAroundWorldAxis(bone, axis, angle) {
  if (!bone || axis.lengthSq() < 1e-10 || Math.abs(angle) < 1e-7) return;
  const delta = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  const worldQuaternion = bone.getWorldQuaternion(new THREE.Quaternion());
  setWorldRotation(bone, delta.multiply(worldQuaternion));
}

function solveTwoBone(root, chain, target, pole) {
  if (!chain) return;
  const { upper, lower, end, firstLength, secondLength } = chain;
  const start = boneWorldPosition(upper);
  const toTarget = target.clone().sub(start);
  const distance = THREE.MathUtils.clamp(
    toTarget.length(),
    Math.abs(firstLength - secondLength) + 1e-4,
    firstLength + secondLength - 1e-4,
  );
  const direction = toTarget.normalize();
  let bendDirection = pole.clone().sub(start);
  bendDirection.addScaledVector(direction, -bendDirection.dot(direction));
  if (bendDirection.lengthSq() < 1e-8) bendDirection.set(1, 0, 0);
  bendDirection.normalize();
  const along = (firstLength * firstLength + distance * distance - secondLength * secondLength) / (2 * distance);
  const height = Math.sqrt(Math.max(0, firstLength * firstLength - along * along));
  const joint = start.clone().addScaledVector(direction, along).addScaledVector(bendDirection, height);
  rotateBoneToward(upper, lower, joint.sub(start));
  root.updateMatrixWorld(true);
  const lowerPosition = boneWorldPosition(lower);
  rotateBoneToward(lower, end, target.clone().sub(lowerPosition));
  root.updateMatrixWorld(true);
}

function markShadowMeshes(group) {
  group.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
}

export function createRiderModel() {
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xff6a2b, roughness: 0.35, metalness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.6 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const jerseyMat = new THREE.MeshStandardMaterial({ color: 0x1c8c8c, roughness: 0.8 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.9 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });

  const root = new THREE.Group();
  const procedural = new THREE.Group();
  root.add(procedural);
  const assetHolder = new THREE.Group();
  assetHolder.visible = false;
  root.add(assetHolder);

  const rearWheel = wheel(tireMat, darkMat);
  rearWheel.position.set(0, WHEEL_R, HALF_BASE);
  procedural.add(rearWheel);

  const fallbackSteer = new THREE.Group();
  fallbackSteer.position.set(0, 0, -HALF_BASE + 0.12);
  procedural.add(fallbackSteer);
  const frontWheel = wheel(tireMat, darkMat);
  frontWheel.position.set(0, WHEEL_R, -0.12);
  fallbackSteer.add(frontWheel);
  fallbackSteer.add(bar(darkMat, [0, WHEEL_R, -0.12], [0, 1.0, 0.08], 0.03));
  fallbackSteer.add(bar(darkMat, [-0.38, 1.04, 0.1], [0.38, 1.04, 0.1], 0.018));

  const bb = [0, 0.33, 0.05];
  procedural.add(bar(frameMat, [0, WHEEL_R, HALF_BASE], bb));
  procedural.add(bar(frameMat, bb, [0, 0.88, -0.36]));
  procedural.add(bar(frameMat, bb, [0, 0.82, 0.18]));
  procedural.add(bar(frameMat, [0, 0.82, 0.18], [0, 0.9, -0.38]));
  procedural.add(bar(frameMat, [0, WHEEL_R, HALF_BASE], [0, 0.82, 0.18], 0.03));
  procedural.add(bar(darkMat, [0, 0.82, 0.18], [0, 0.95, 0.24], 0.02));
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.26), darkMat);
  saddle.position.set(0, 0.97, 0.26);
  procedural.add(saddle);

  const fallbackCrank = new THREE.Group();
  fallbackCrank.position.set(...bb);
  fallbackCrank.add(bar(darkMat, [0.08, 0, 0], [0.08, -PEDAL_R, 0], 0.015));
  fallbackCrank.add(bar(darkMat, [-0.08, 0, 0], [-0.08, PEDAL_R, 0], 0.015));
  procedural.add(fallbackCrank);

  const fallbackRider = new THREE.Group();
  procedural.add(fallbackRider);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), jerseyMat);
  torso.position.set(0, 1.32, 0.02);
  torso.rotation.x = -1.0;
  fallbackRider.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), helmetMat);
  head.position.set(0, 1.58, -0.28);
  head.scale.set(1, 0.9, 1.25);
  fallbackRider.add(head);
  for (const side of [-1, 1]) {
    fallbackRider.add(bar(jerseyMat, [side * 0.18, 1.45, -0.12], [side * 0.34, 1.06, 0.06], 0.05));
    fallbackRider.add(bar(pantsMat, [side * 0.12, 1.12, 0.22], [side * 0.14, 0.72, -0.08], 0.07));
    fallbackRider.add(bar(pantsMat, [side * 0.14, 0.72, -0.08], [side * 0.11, 0.36, 0.05], 0.055));
  }
  markShadowMeshes(procedural);

  const pitchSpring = spring();
  const cadenceSpring = spring();
  const postureY = spring();
  const postureZ = spring();
  const hipSide = spring();
  const hipLanding = spring();
  const torsoPitch = spring();
  const torsoRoll = spring();
  const landingCompression = spring();
  const handTargets = [vectorSpring(), vectorSpring()];
  const footTargets = [vectorSpring(), vectorSpring()];
  let bikeAsset = null;
  let riderRoot = null;
  let riderBaseY = WHEEL_R;
  let riderScene = null;
  let riderBones = null;
  let bindBones = null;
  let boneAxes = null;
  let footChains = [];
  let handChains = [];
  let assetSteer = null;
  let assetCrank = null;
  let lastAirSpeed = 0;
  let wasAirborne = false;

  function setAssets({ riderBody, bikeBody } = {}) {
    if (!riderBody?.scene || !bikeBody?.scene) return false;
    assetHolder.clear();
    assetHolder.scale.setScalar(1);
    assetHolder.position.set(0, 0, 0);
    assetHolder.rotation.set(0, 0, 0);

    bikeAsset = new THREE.Group();
    const bikeScene = bikeBody.scene;
    bikeAsset.add(bikeScene);
    assetHolder.add(bikeAsset);

    riderRoot = new THREE.Group();
    riderScene = riderBody.scene;
    riderRoot.add(riderScene);
    assetHolder.add(riderRoot);

    const bikeBox = new THREE.Box3().setFromObject(bikeScene);
    const bikeSize = bikeBox.getSize(new THREE.Vector3());
    const bikeCenter = bikeBox.getCenter(new THREE.Vector3());
    if (bikeSize.x < 1e-4 || bikeSize.y < 1e-4) {
      assetHolder.clear();
      return false;
    }
    const bikeScale = (2 * (HALF_BASE + WHEEL_R)) / bikeSize.x;
    bikeAsset.scale.setScalar(bikeScale);
    bikeAsset.rotation.y = -Math.PI / 2;
    bikeScene.position.set(-bikeCenter.x, -bikeBox.min.y, -bikeCenter.z);

    const riderBox = new THREE.Box3().setFromObject(riderScene);
    const riderSize = riderBox.getSize(new THREE.Vector3());
    if (riderSize.y < 1e-4) {
      assetHolder.clear();
      return false;
    }
    riderRoot.scale.setScalar(1.7 / riderSize.y);
    riderRoot.rotation.y = Math.PI;
    riderBaseY = WHEEL_R - riderBox.min.y * riderRoot.scale.y;
    riderRoot.position.set(0, riderBaseY, 0);

    assetSteer = new THREE.Group();
    assetSteer.position.set(0, WHEEL_R, -HALF_BASE);
    assetHolder.add(assetSteer);
    assetCrank = new THREE.Group();
    assetCrank.position.set(0, 0.35, 0.02);
    assetCrank.add(bar(darkMat, [0.075, 0, 0], [0.075, -PEDAL_R, 0], 0.012));
    assetCrank.add(bar(darkMat, [-0.075, 0, 0], [-0.075, PEDAL_R, 0], 0.012));
    for (const side of [-1, 1]) {
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.035, 0.11), darkMat);
      pedal.position.set(side * 0.075, side > 0 ? -PEDAL_R : PEDAL_R, 0);
      assetCrank.add(pedal);
    }
    assetHolder.add(assetCrank);
    markShadowMeshes(assetHolder);

    root.updateMatrixWorld(true);
    bikeScene.updateMatrixWorld(true);
    riderScene.updateMatrixWorld(true);
    const { bones, bind } = getRiderBones(riderScene);
    riderBones = bones;
    bindBones = bind;
    const required = [
      bones.hips, bones.spine, bones.spine1, bones.spine2, bones.head,
      bones.leftArm, bones.leftForeArm, bones.leftHand,
      bones.rightArm, bones.rightForeArm, bones.rightHand,
      bones.leftUpLeg, bones.leftLeg, bones.leftFoot,
      bones.rightUpLeg, bones.rightLeg, bones.rightFoot,
      bones.leftShoulder, bones.rightShoulder, bones.neck,
    ];
    if (required.some((bone) => !bone)) {
      assetHolder.clear();
      assetHolder.visible = false;
      return false;
    }

    const leftShoulder = boneWorldPosition(bones.leftShoulder);
    const rightShoulder = boneWorldPosition(bones.rightShoulder);
    const hipsPosition = boneWorldPosition(bones.hips);
    const neckPosition = boneWorldPosition(bones.neck);
    const inverseHolder = assetHolder.matrixWorld.clone().invert();
    const lateral = leftShoulder.sub(rightShoulder).transformDirection(inverseHolder).normalize();
    const up = neckPosition.sub(hipsPosition).transformDirection(inverseHolder).normalize();
    const forward = up.clone().cross(lateral).normalize();
    if (lateral.lengthSq() < 1e-6 || up.lengthSq() < 1e-6 || forward.lengthSq() < 1e-6) {
      assetHolder.clear();
      assetHolder.visible = false;
      return false;
    }
    boneAxes = { lateral, forward };
    footChains = [
      makeChain(bones.leftUpLeg, bones.leftLeg, bones.leftFoot),
      makeChain(bones.rightUpLeg, bones.rightLeg, bones.rightFoot),
    ];
    handChains = [
      makeChain(bones.leftArm, bones.leftForeArm, bones.leftHand),
      makeChain(bones.rightArm, bones.rightForeArm, bones.rightHand),
    ];
    if (footChains.some((chain) => !chain) || handChains.some((chain) => !chain)) {
      assetHolder.clear();
      assetHolder.visible = false;
      return false;
    }
    footTargets.forEach((target) => {
      target.x.value = 0;
      target.y.value = 0.35;
      target.z.value = 0;
    });
    handTargets.forEach((target) => {
      target.x.value = 0;
      target.y.value = 0.95;
      target.z.value = -HALF_BASE;
    });
    assetHolder.visible = true;
    procedural.visible = false;
    return true;
  }

  function resetBonePose() {
    for (const [bone, bind] of bindBones) {
      bone.position.copy(bind.position);
      bone.quaternion.copy(bind.quaternion);
    }
  }

  function pedalPoint(side, phase) {
    const angle = phase + (side > 0 ? Math.PI : 0);
    return new THREE.Vector3(
      side * 0.075,
      0.35 + PEDAL_R * Math.cos(angle),
      0.02 + PEDAL_R * Math.sin(angle),
    );
  }

  function updateAssetPose(bike, input, grade, dt, speed01) {
    const brake = THREE.MathUtils.clamp(bike.brake || 0, 0, 1);
    const standing = Math.min(0.08, Math.max(0, bike.v) * 0.004);
    const roughness = bike.slipping ? 0.045 : Math.min(0.025, Math.abs(grade) * 0.015);
    let targetY = standing + roughness - (input.throttle && bike.v < 4 ? 0.05 : 0);
    if (bike.airborne) targetY -= 0.015;
    stepSpring(postureY, targetY, dt, 10);
    stepSpring(postureZ, brake * 0.15 - (input.throttle ? 0.03 : 0), dt, 11);
    stepSpring(hipSide, -bike.lean * 0.08, dt, 12);
    stepSpring(hipLanding, -0.08 * landingCompression.value, dt, 18);

    const targetTorso = brake > 0.1
      ? -0.15 * brake
      : Math.min(0.25, 0.04 + speed01 * 0.12 + (input.throttle ? 0.08 : 0));
    const tuck = bike.airborne ? 0.14 : 0;
    stepSpring(torsoPitch, targetTorso + tuck, dt, 12);
    stepSpring(torsoRoll, 0.3 * bike.lean, dt, 12);

    riderRoot.position.set(0, riderBaseY + postureY.value, postureZ.value);
    resetBonePose();
    const hipsBind = bindBones.get(riderBones.hips);
    riderBones.hips.position.x = hipsBind.position.x + hipSide.value;
    riderBones.hips.position.y = hipsBind.position.y + hipLanding.value;
    root.updateMatrixWorld(true);

    const lateralWorld = boneAxes.lateral.clone().transformDirection(assetHolder.matrixWorld);
    const forwardWorld = boneAxes.forward.clone().transformDirection(assetHolder.matrixWorld);
    const pitchPortion = torsoPitch.value / 3;
    rotateBoneAroundWorldAxis(riderBones.spine, lateralWorld, -pitchPortion);
    root.updateMatrixWorld(true);
    rotateBoneAroundWorldAxis(riderBones.spine1, lateralWorld, -pitchPortion);
    root.updateMatrixWorld(true);
    rotateBoneAroundWorldAxis(riderBones.spine2, lateralWorld, -pitchPortion);
    root.updateMatrixWorld(true);
    rotateBoneAroundWorldAxis(riderBones.hips, forwardWorld, -torsoRoll.value);
    root.updateMatrixWorld(true);
    rotateBoneAroundWorldAxis(riderBones.spine, forwardWorld, -torsoRoll.value);
    root.updateMatrixWorld(true);
    rotateBoneAroundWorldAxis(riderBones.spine1, forwardWorld, -torsoRoll.value);
    root.updateMatrixWorld(true);
    rotateBoneAroundWorldAxis(riderBones.spine2, forwardWorld, -torsoRoll.value);
    root.updateMatrixWorld(true);

    assetSteer.rotation.y = -bike.steer;
    assetCrank.rotation.x = cadenceSpring.value;
    root.updateMatrixWorld(true);

    for (const [index, side] of [-1, 1].entries()) {
      const footLocal = pedalPoint(side, cadenceSpring.value);
      footLocal.y += 0.045;
      const smoothedFoot = stepVectorSpring(footTargets[index], footLocal, dt, 18);
      const footTarget = assetHolder.localToWorld(smoothedFoot);
      const kneePole = assetHolder.localToWorld(new THREE.Vector3(side * 0.27, 0.30, -0.32));
      solveTwoBone(root, footChains[index], footTarget, kneePole);

      const gripWorld = assetSteer.localToWorld(new THREE.Vector3(side * 0.34, 0.59, 0.08));
      const gripLocal = assetHolder.worldToLocal(gripWorld);
      const smoothedGrip = stepVectorSpring(handTargets[index], gripLocal, dt, 16);
      const handTarget = assetHolder.localToWorld(smoothedGrip);
      const elbowPole = assetHolder.localToWorld(new THREE.Vector3(side * 0.38, 0.85, 0.22));
      solveTwoBone(root, handChains[index], handTarget, elbowPole);
    }

    const headPitch = -(torsoPitch.value + pitchSpring.value);
    rotateBoneAroundWorldAxis(riderBones.head, lateralWorld, headPitch);
    rotateBoneAroundWorldAxis(riderBones.head, forwardWorld, 1.3 * bike.lean);
    root.updateMatrixWorld(true);
  }

  return {
    root,
    setAssets,
    update(bike, input, grade, dt) {
      const speed01 = Math.min(1, bike.v / 16);
      const targetPitch = bike.airborne
        ? Math.atan2(bike.vy, Math.max(bike.v, 1)) * 0.6
        : Math.atan(grade);
      const pitch = stepSpring(pitchSpring, targetPitch, dt, 10);
      root.rotation.set(pitch, -bike.heading, -bike.lean, 'YXZ');
      if (bike.airborne) lastAirSpeed = Math.abs(bike.vy || 0);
      if (wasAirborne && !bike.airborne) {
        landingCompression.value = Math.min(1, Math.max(0.25, lastAirSpeed / 8));
        landingCompression.velocity = 0;
      }
      stepSpring(landingCompression, 0, dt, 7);
      wasAirborne = !!bike.airborne;

      const cadenceRate = input.throttle && !bike.airborne
        ? Math.max(0, bike.v) / WHEEL_R / 2.2
        : 0;
      cadenceSpring.value += cadenceRate * dt;
      if (assetHolder.visible) {
        updateAssetPose(bike, input, grade, dt, speed01);
      } else {
        const crouch = bike.airborne ? -0.1 : input.throttle ? -0.02 * Math.sin(cadenceSpring.value * 2) : -0.05;
        const shift = Math.max(0, Math.min(1, bike.brake)) * 0.12;
        fallbackRider.position.y += (crouch - fallbackRider.position.y) * (1 - Math.exp(-10 * dt));
        fallbackRider.position.z += (shift - fallbackRider.position.z) * (1 - Math.exp(-10 * dt));
        fallbackRider.rotation.z = Math.sin(cadenceSpring.value) * 0.04 * (input.throttle ? 1 : 0);
        rearWheel.rotation.x -= (bike.v / WHEEL_R) * dt;
        frontWheel.rotation.x -= (bike.v / WHEEL_R) * dt;
        fallbackSteer.rotation.y = -bike.steer;
        fallbackCrank.rotation.x = cadenceSpring.value;
      }
      root.updateMatrixWorld(true);
    },
  };
}
