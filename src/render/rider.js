import * as THREE from 'three';
import { G } from '../physics/constants.js';

const WHEEL_R = 0.36;
const HALF_BASE = 0.575;
const PEDAL_R = 0.17;
const CRANK_Y = WHEEL_R + PEDAL_R;
const CRANK_Z = 0.02;
const BACK_PRINT_OFFSET = 0.13;
const RIDER_RIG_CORRECTIONS = {
  'rider-red': { yaw: 0 },
  'rider-black': { yaw: 0 },
};

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
  g.add(new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.07, 0.07, 8, 28).rotateY(Math.PI / 2), tire));
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

function boxCorners(box) {
  const { min, max } = box;
  return [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ];
}

function getDeformedRiderBounds(scene) {
  scene.updateMatrixWorld(true);
  const inverseSceneWorld = scene.matrixWorld.clone().invert();
  const bounds = new THREE.Box3();
  const vertex = new THREE.Vector3();
  scene.traverse((object) => {
    if (!object.isSkinnedMesh) return;
    object.skeleton.update();
    const objectToScene = inverseSceneWorld.clone().multiply(object.matrixWorld);
    const position = object.geometry.getAttribute('position');
    for (let index = 0; index < position.count; index += 1) {
      object.getVertexPosition(index, vertex);
      bounds.expandByPoint(vertex.applyMatrix4(objectToScene));
    }
  });
  return bounds;
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
  return name.replace(/^mixamorig:?/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function getRiderBones(scene) {
  const byName = new Map();
  const diagnostics = [];
  const addBone = (bone) => {
    if (bone?.isBone) byName.set(normalizedBoneName(bone.name), bone);
  };
  scene.traverse((object) => {
    if (object.name || object.isSkinnedMesh || object.skeleton) {
      diagnostics.push({
        name: object.name,
        type: object.type,
        isBone: Boolean(object.isBone),
        isSkinnedMesh: Boolean(object.isSkinnedMesh),
        skeletonBones: object.skeleton?.bones?.length || 0,
      });
    }
    addBone(object);
    if (object.isSkinnedMesh) object.skeleton?.bones.forEach(addBone);
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
  return { bones, bind, diagnostics };
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
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
  const jerseyMat = new THREE.MeshStandardMaterial({ color: 0x1c8c8c, roughness: 0.8 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.9 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });

  const root = new THREE.Group();
  const headlamp = new THREE.SpotLight(0xffe3ba, 180, 40, 0.5, 0.45, 2);
  headlamp.position.set(0, 1.68, -0.35);
  headlamp.target.position.set(0, 1.15, -18);
  headlamp.castShadow = false;
  headlamp.visible = false;
  root.add(headlamp, headlamp.target);
  const procedural = new THREE.Group();
  root.add(procedural);
  const fallbackBike = new THREE.Group();
  procedural.add(fallbackBike);
  const assetHolder = new THREE.Group();
  assetHolder.visible = false;
  root.add(assetHolder);

  let assetBikeMotion = null;
  let assetRiderMotion = null;
  const fallbackRiderMotion = new THREE.Group();
  procedural.add(fallbackRiderMotion);

  const rearWheel = wheel(tireMat, darkMat);
  rearWheel.position.set(0, WHEEL_R, HALF_BASE);
  fallbackBike.add(rearWheel);

  const fallbackSteer = new THREE.Group();
  fallbackSteer.position.set(0, 0, -HALF_BASE + 0.12);
  fallbackBike.add(fallbackSteer);
  const frontWheel = wheel(tireMat, darkMat);
  frontWheel.position.set(0, WHEEL_R, -0.12);
  fallbackSteer.add(frontWheel);
  fallbackSteer.add(bar(darkMat, [0, WHEEL_R, -0.12], [0, 1.0, 0.08], 0.03));
  fallbackSteer.add(bar(darkMat, [-0.38, 1.04, 0.1], [0.38, 1.04, 0.1], 0.018));

  const bb = [0, 0.33, 0.05];
  fallbackBike.add(bar(frameMat, [0, WHEEL_R, HALF_BASE], bb));
  fallbackBike.add(bar(frameMat, bb, [0, 0.88, -0.36]));
  fallbackBike.add(bar(frameMat, bb, [0, 0.82, 0.18]));
  fallbackBike.add(bar(frameMat, [0, 0.82, 0.18], [0, 0.9, -0.38]));
  fallbackBike.add(bar(frameMat, [0, WHEEL_R, HALF_BASE], [0, 0.82, 0.18], 0.03));
  fallbackBike.add(bar(darkMat, [0, 0.82, 0.18], [0, 0.95, 0.24], 0.02));
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.26), darkMat);
  saddle.position.set(0, 0.97, 0.26);
  fallbackBike.add(saddle);

  const fallbackCrank = new THREE.Group();
  fallbackCrank.position.set(...bb);
  fallbackCrank.add(bar(darkMat, [0.08, 0, 0], [0.08, -PEDAL_R, 0], 0.015));
  fallbackCrank.add(bar(darkMat, [-0.08, 0, 0], [-0.08, PEDAL_R, 0], 0.015));
  fallbackBike.add(fallbackCrank);

  const fallbackRider = new THREE.Group();
  fallbackRiderMotion.add(fallbackRider);
  let fallbackWaveArm;
  let fallbackWaveForeArm;
  let fallbackWaveHand;
  let fallbackWaveChain;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 4, 10), jerseyMat);
  torso.position.set(0, 1.32, 0.02);
  torso.rotation.x = -1.0;
  fallbackRider.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), helmetMat);
  head.position.set(0, 1.58, -0.28);
  head.scale.set(1, 0.9, 1.25);
  fallbackRider.add(head);
  for (const side of [-1, 1]) {
    if (side > 0) {
      fallbackWaveArm = new THREE.Group();
      fallbackWaveArm.position.set(0.18, 1.45, -0.12);
      fallbackWaveForeArm = new THREE.Group();
      fallbackWaveForeArm.position.set(0.08, -0.2, 0.08);
      fallbackRider.add(fallbackWaveArm);
      fallbackWaveArm.add(bar(jerseyMat, [0, 0, 0], [0.08, -0.2, 0.08], 0.05));
      fallbackWaveArm.add(fallbackWaveForeArm);
      fallbackWaveForeArm.add(bar(jerseyMat, [0, 0, 0], [0.08, -0.19, 0.1], 0.045));
      fallbackWaveHand = new THREE.Group();
      fallbackWaveHand.position.set(0.08, -0.19, 0.1);
      fallbackWaveForeArm.add(fallbackWaveHand);
      const fallbackPalm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.035), helmetMat);
      fallbackPalm.position.set(0.02, 0, 0.02);
      fallbackWaveHand.add(fallbackPalm);
    } else {
      fallbackRider.add(bar(jerseyMat, [side * 0.18, 1.45, -0.12], [side * 0.34, 1.06, 0.06], 0.05));
    }
    fallbackRider.add(bar(pantsMat, [side * 0.12, 1.12, 0.22], [side * 0.14, 0.72, -0.08], 0.07));
    fallbackRider.add(bar(pantsMat, [side * 0.14, 0.72, -0.08], [side * 0.11, 0.36, 0.05], 0.055));
  }
  fallbackWaveChain = makeChain(fallbackWaveArm, fallbackWaveForeArm, fallbackWaveHand);
  const fallbackRiderCorners = boxCorners(new THREE.Box3().setFromObject(fallbackRider));
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
  let assetFrontWheel = null;
  let assetRearWheel = null;
  let riderCorners = [];
  let backPrintMesh = null;
  let lastAirSpeed = 0;
  let wasAirborne = false;
  let assetStatus = { ready: false, reason: 'Assets have not been applied' };
  let crashState = null;
  let wavePoseActive = false;
  let wavePoseTime = 0;

  function setAssets({
    riderBody,
    bikeFrame,
    bikeWheel,
    backPrint,
    riderId = 'rider-body',
  } = {}) {
    const failAssetSetup = (reason, details = {}) => {
      assetHolder.clear();
      assetHolder.visible = false;
      procedural.visible = true;
      assetStatus = { ready: false, reason, ...details };
      return false;
    };
    if (!riderBody?.scene || !bikeFrame?.scene || !bikeWheel?.scene) {
      return failAssetSetup('Missing rider-body, bike-frame, or bike-wheel scene');
    }
    assetStatus = { ready: false, reason: 'Validating rider and bike models' };
    assetHolder.clear();
    backPrintMesh = null;
    assetHolder.scale.setScalar(1);
    assetHolder.position.set(0, 0, 0);
    assetHolder.rotation.set(0, 0, 0);
    assetBikeMotion = new THREE.Group();
    assetRiderMotion = new THREE.Group();
    assetHolder.add(assetBikeMotion, assetRiderMotion);

    const rigCorrection = RIDER_RIG_CORRECTIONS[riderId];
    const bikeScene = bikeFrame.scene;
    const bikeBox = new THREE.Box3().setFromObject(bikeScene);
    const bikeSize = bikeBox.getSize(new THREE.Vector3());
    const bikeCenter = bikeBox.getCenter(new THREE.Vector3());
    if (bikeSize.x < 1e-4 || bikeSize.y < 1e-4 || bikeSize.z < 1e-4) {
      return failAssetSetup(`Bike bounds are invalid: ${bikeSize.toArray().join(', ')}`);
    }

    riderScene = riderBody.scene;
    const skinnedRiderBounds = riderId === 'rider-body'
      ? null
      : getDeformedRiderBounds(riderScene);
    const riderBox = skinnedRiderBounds && !skinnedRiderBounds.isEmpty()
      ? skinnedRiderBounds
      : new THREE.Box3().setFromObject(riderScene);
    riderCorners = boxCorners(riderBox);
    const riderSize = riderBox.getSize(new THREE.Vector3());
    if (riderSize.y < 1e-4) {
      return failAssetSetup(`Rider height is invalid: ${riderSize.y}`);
    }

    bikeAsset = new THREE.Group();
    bikeAsset.add(bikeScene);
    assetBikeMotion.add(bikeAsset);

    riderRoot = new THREE.Group();
    riderRoot.add(riderScene);
    assetRiderMotion.add(riderRoot);

    const bikeLongAxis = bikeSize.x > bikeSize.z ? 'x' : 'z';
    const bikeScale = (2 * HALF_BASE) / Math.max(bikeSize.x, bikeSize.z);
    bikeAsset.scale.setScalar(bikeScale);
    bikeAsset.rotation.y = bikeLongAxis === 'x' ? -Math.PI / 2 : 0;
    bikeAsset.position.y = WHEEL_R;
    bikeScene.position.set(-bikeCenter.x, -bikeBox.min.y, -bikeCenter.z);

    const wheelBox = new THREE.Box3().setFromObject(bikeWheel.scene);
    const wheelSize = wheelBox.getSize(new THREE.Vector3());
    const wheelDiameter = Math.max(wheelSize.x, wheelSize.y);
    if (wheelDiameter < 1e-4) {
      return failAssetSetup(`Bike wheel bounds are invalid: ${wheelSize.toArray().join(', ')}`);
    }
    const wheelCenter = wheelBox.getCenter(new THREE.Vector3());
    const wheelScale = (2 * (WHEEL_R - 0.06)) / wheelDiameter;
    const makeSpinningWheel = (parent, position) => {
      const pivot = new THREE.Group();
      pivot.position.copy(position);
      parent.add(pivot);
      pivot.add(
        new THREE.Mesh(
          new THREE.TorusGeometry(WHEEL_R - 0.07, 0.07, 8, 28).rotateY(Math.PI / 2),
          tireMat,
        ),
      );
      const mount = new THREE.Group();
      mount.rotation.y = Math.PI / 2;
      mount.scale.setScalar(wheelScale);
      pivot.add(mount);
      const wheelScene = bikeWheel.scene.clone(true);
      wheelScene.position.sub(wheelCenter);
      mount.add(wheelScene);
      return pivot;
    };

    riderRoot.scale.setScalar(1.7 / riderSize.y);
    riderRoot.rotation.y = Math.PI + (rigCorrection?.yaw ?? 0);
    riderBaseY = WHEEL_R - riderBox.min.y * riderRoot.scale.y;
    riderRoot.position.set(0, riderBaseY, 0);

    assetSteer = new THREE.Group();
    assetSteer.position.set(0, WHEEL_R, -HALF_BASE);
    assetBikeMotion.add(assetSteer);
    assetFrontWheel = makeSpinningWheel(assetSteer, new THREE.Vector3());
    assetRearWheel = makeSpinningWheel(
      assetBikeMotion,
      new THREE.Vector3(0, WHEEL_R, HALF_BASE),
    );
    assetCrank = new THREE.Group();
    assetCrank.position.set(0, CRANK_Y, CRANK_Z);
    assetCrank.add(bar(darkMat, [0.075, 0, 0], [0.075, -PEDAL_R, 0], 0.012));
    assetCrank.add(bar(darkMat, [-0.075, 0, 0], [-0.075, PEDAL_R, 0], 0.012));
    for (const side of [-1, 1]) {
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.035, 0.11), darkMat);
      pedal.position.set(side * 0.075, side > 0 ? -PEDAL_R : PEDAL_R, 0);
      assetCrank.add(pedal);
    }
    assetBikeMotion.add(assetCrank);
    markShadowMeshes(assetHolder);

    root.updateMatrixWorld(true);
    bikeScene.updateMatrixWorld(true);
    riderScene.updateMatrixWorld(true);
    const { bones, bind, diagnostics } = getRiderBones(riderScene);
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
      const missing = Object.entries(bones).filter(([, bone]) => !bone).map(([name]) => name);
      return failAssetSetup(`Missing rider bones: ${missing.join(', ')}`, { diagnostics });
    }
    if (backPrint) {
      backPrint.colorSpace = THREE.SRGBColorSpace;
      const spineScale = bones.spine2.getWorldScale(new THREE.Vector3());
      const imageWidth = backPrint.image?.width || 1;
      const imageHeight = backPrint.image?.height || 1;
      const print = new THREE.Mesh(
        new THREE.PlaneGeometry(0.22, 0.22 * imageHeight / imageWidth),
        new THREE.MeshBasicMaterial({
          map: backPrint,
          transparent: true,
          depthWrite: false,
          depthTest: true,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          toneMapped: false,
        }),
      );
      const riderRotation = riderRoot.getWorldQuaternion(new THREE.Quaternion());
      const backDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(riderRotation).normalize();
      const printWorldPosition = boneWorldPosition(bones.spine2)
        .addScaledVector(backDirection, BACK_PRINT_OFFSET);
      printWorldPosition.y += 0.04;
      print.position.copy(bones.spine2.worldToLocal(printWorldPosition));
      print.scale.set(1 / Math.abs(spineScale.x), 1 / Math.abs(spineScale.y), 1 / Math.abs(spineScale.z));
      const printWorldRotation = new THREE.Quaternion()
        .setFromUnitVectors(new THREE.Vector3(0, 0, 1), backDirection);
      print.quaternion.copy(
        bones.spine2.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(printWorldRotation),
      );
      print.renderOrder = 2;
      bones.spine2.add(print);
      backPrintMesh = print;
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
      return failAssetSetup('Could not derive bind-space bone directions');
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
      return failAssetSetup('Rider arm or leg chain has a zero-length bind segment');
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
    assetStatus = { ready: true, reason: null, bike: 'bike-frame with spinning bike-wheel overlays' };
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
      CRANK_Y + PEDAL_R * Math.cos(angle),
      CRANK_Z + PEDAL_R * Math.sin(angle),
    );
  }

  function moveGroupToWorldPosition(group, position) {
    root.updateMatrixWorld(true);
    group.parent.updateWorldMatrix(true, false);
    group.position.copy(group.parent.worldToLocal(position.clone()));
  }

  function worldBoundsMinY(matrix, corners) {
    let minY = Infinity;
    for (const corner of corners) {
      minY = Math.min(minY, corner.clone().applyMatrix4(matrix).y);
    }
    return minY;
  }

  function startCrash({ v = 0, heading = 0, reason = null } = {}) {
    root.updateMatrixWorld(true);
    const riderPosition = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
    const rollDirection = Math.random() < 0.5 ? -1 : 1;
    crashState = {
      heading,
      reason,
      riderPosition,
      riderVelocity: new THREE.Vector3(
        Math.sin(heading) * 0.6 * Math.max(0, v),
        2.5,
        -Math.cos(heading) * 0.6 * Math.max(0, v),
      ),
      pitchVelocity: 7,
      rollVelocity: (Math.random() - 0.5) * 1.2,
      bikeSpeed: Math.max(0, v) * 0.25,
      bikeRoll: spring(),
      bikeRollTarget: rollDirection * (80 * Math.PI / 180),
      bounces: 0,
      onGround: false,
    };
    fallbackRider.position.set(0, 0, 0);
    fallbackRider.rotation.set(0, 0, 0);
  }

  function resetCrash() {
    crashState = null;
    fallbackBike.position.set(0, 0, 0);
    fallbackBike.rotation.set(0, 0, 0);
    fallbackRiderMotion.position.set(0, 0, 0);
    fallbackRiderMotion.rotation.set(0, 0, 0);
    fallbackRider.position.set(0, 0, 0);
    fallbackRider.rotation.set(0, 0, 0);
    assetBikeMotion?.position.set(0, 0, 0);
    assetBikeMotion?.rotation.set(0, 0, 0);
    assetRiderMotion?.position.set(0, 0, 0);
    assetRiderMotion?.rotation.set(0, 0, 0);
    wasAirborne = false;
    lastAirSpeed = 0;
    landingCompression.value = 0;
    landingCompression.velocity = 0;
  }

  function updateCrash(dt, heightAt) {
    if (!crashState) return;
    const bikeMotion = assetHolder.visible ? assetBikeMotion : fallbackBike;
    const riderMotion = assetHolder.visible ? assetRiderMotion : fallbackRiderMotion;
    crashState.riderVelocity.y -= G * dt;
    crashState.riderPosition.addScaledVector(crashState.riderVelocity, dt);
    moveGroupToWorldPosition(riderMotion, crashState.riderPosition);
    riderMotion.rotation.x += crashState.pitchVelocity * dt;
    riderMotion.rotation.z += crashState.rollVelocity * dt;

    crashState.bikeSpeed = Math.max(0, crashState.bikeSpeed - 6 * dt);
    bikeMotion.position.z -= crashState.bikeSpeed * dt;
    bikeMotion.rotation.z = stepSpring(
      crashState.bikeRoll,
      crashState.bikeRollTarget,
      dt,
      9,
    );
    if (assetHolder.visible) {
      assetFrontWheel.rotation.x -= (crashState.bikeSpeed / WHEEL_R) * dt;
      assetRearWheel.rotation.x -= (crashState.bikeSpeed / WHEEL_R) * dt;
    } else {
      frontWheel.rotation.x -= (crashState.bikeSpeed / WHEEL_R) * dt;
      rearWheel.rotation.x -= (crashState.bikeSpeed / WHEEL_R) * dt;
    }

    root.updateMatrixWorld(true);
    const riderBoundsMatrix = assetHolder.visible
      ? riderRoot.matrixWorld
      : fallbackRiderMotion.matrixWorld;
    const corners = assetHolder.visible ? riderCorners : fallbackRiderCorners;
    const boundsMinY = worldBoundsMinY(riderBoundsMatrix, corners);
    const groundY = typeof heightAt === 'function'
      ? heightAt(crashState.riderPosition.x, crashState.riderPosition.z)
      : root.position.y;
    const lowestY = Math.min(boundsMinY, crashState.riderPosition.y);
    crashState.onGround = lowestY <= groundY;
    if (crashState.onGround) {
      crashState.riderPosition.y += Math.max(0, groundY - lowestY);
      moveGroupToWorldPosition(riderMotion, crashState.riderPosition);
      if (crashState.riderVelocity.y < 0) {
        if (crashState.bounces === 0 && -crashState.riderVelocity.y > 0.5) {
          crashState.riderVelocity.y *= -0.3;
          crashState.bounces = 1;
        } else {
          crashState.riderVelocity.y = 0;
        }
      }
      const groundDamping = Math.exp(-2.8 * dt);
      crashState.riderVelocity.x *= groundDamping;
      crashState.riderVelocity.z *= groundDamping;
      crashState.pitchVelocity *= Math.exp(-5.5 * dt);
      crashState.rollVelocity *= Math.exp(-5.5 * dt);
    }
  }

  function updateAssetPose(bike, input, grade, dt, speed01, crashing = false) {
    const brake = THREE.MathUtils.clamp(bike.brake || 0, 0, 1);
    const standing = Math.min(0.08, Math.max(0, bike.v) * 0.004);
    const roughness = bike.slipping ? 0.045 : Math.min(0.025, Math.abs(grade) * 0.015);
    const jumpPose = bike.jumpCooldown > 0.3
      ? -0.07
      : bike.airborne && bike.jumpCooldown > 0
        ? 0.06
        : 0;
    let targetY = standing + roughness + jumpPose - (input.throttle && bike.v < 4 ? 0.05 : 0);
    if (bike.airborne) targetY -= 0.015;
    stepSpring(postureY, targetY, dt, 10);
    stepSpring(postureZ, brake * 0.15 - (input.throttle ? 0.03 : 0), dt, 11);
    stepSpring(hipSide, -bike.lean * 0.08, dt, 12);
    stepSpring(hipLanding, -0.08 * landingCompression.value, dt, 18);

    const targetTorso = crashing
      ? 0.28
      : brake > 0.1
        ? -0.15 * brake
        : Math.min(0.25, 0.04 + speed01 * 0.12 + (input.throttle ? 0.08 : 0));
    const tuck = crashing ? 0.08 : bike.airborne ? 0.14 : 0;
    stepSpring(torsoPitch, targetTorso + tuck, dt, 12);
    stepSpring(torsoRoll, 0.3 * bike.lean, dt, 12);

    riderRoot.position.set(0, riderBaseY + postureY.value, postureZ.value);
    resetBonePose();
    const hipsBind = bindBones.get(riderBones.hips);
    riderBones.hips.position.x = hipsBind.position.x + hipSide.value;
    riderBones.hips.position.y = hipsBind.position.y + hipLanding.value;
    root.updateMatrixWorld(true);

    const lateralWorld = boneAxes.lateral.clone().transformDirection(assetRiderMotion.matrixWorld);
    const forwardWorld = boneAxes.forward.clone().transformDirection(assetRiderMotion.matrixWorld);
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
    assetFrontWheel.rotation.x -= (bike.v / WHEEL_R) * dt;
    assetRearWheel.rotation.x -= (bike.v / WHEEL_R) * dt;
    root.updateMatrixWorld(true);

    for (const [index, side] of [-1, 1].entries()) {
      const footLocal = crashing
        ? new THREE.Vector3(side * 0.18, 0.52, 0.18)
        : pedalPoint(side, cadenceSpring.value);
      if (!crashing) footLocal.y += 0.045;
      const smoothedFoot = stepVectorSpring(footTargets[index], footLocal, dt, crashing ? 8 : 18);
      const footTarget = assetRiderMotion.localToWorld(smoothedFoot);
      const kneePole = assetRiderMotion.localToWorld(
        crashing
          ? new THREE.Vector3(side * 0.32, 0.42, -0.06)
          : new THREE.Vector3(side * 0.27, 0.30, -0.32),
      );
      solveTwoBone(root, footChains[index], footTarget, kneePole);

      const gripLocal = crashing
        ? new THREE.Vector3(side * 0.68, 1.2, -0.02)
        : assetRiderMotion.worldToLocal(
          assetSteer.localToWorld(new THREE.Vector3(side * 0.215, 0.665, 0.385)),
        );
      const waving = wavePoseActive && side > 0 && !crashing;
      const shoulderLocal = waving
        ? assetRiderMotion.worldToLocal(boneWorldPosition(riderBones.rightShoulder))
        : null;
      const waveTargetLocal = waving
        ? shoulderLocal.clone().add(new THREE.Vector3(
          side * 0.30 + Math.sin(wavePoseTime * Math.PI * 4) * 0.12,
          0.50,
          0.20,
        ))
        : gripLocal;
      const smoothedGrip = waving
        ? waveTargetLocal
        : stepVectorSpring(handTargets[index], gripLocal, dt, crashing ? 8 : 16);
      if (waving) {
        handTargets[index].x.value = waveTargetLocal.x;
        handTargets[index].x.velocity = 0;
        handTargets[index].y.value = waveTargetLocal.y;
        handTargets[index].y.velocity = 0;
        handTargets[index].z.value = waveTargetLocal.z;
        handTargets[index].z.velocity = 0;
      }
      const handTarget = assetRiderMotion.localToWorld(smoothedGrip);
      const elbowPole = assetRiderMotion.localToWorld(
        waving
          ? shoulderLocal.clone().add(new THREE.Vector3(side * 0.55, 0.15, 0.35))
          : crashing
            ? new THREE.Vector3(side * 0.58, 0.9, 0.25)
            : new THREE.Vector3(side * 0.38, 0.85, 0.22),
      );
      solveTwoBone(root, handChains[index], handTarget, elbowPole);
      if (waving) rotateBoneAroundWorldAxis(riderBones.rightHand, forwardWorld, Math.PI / 2);
    }

    const headPitch = -(torsoPitch.value + pitchSpring.value);
    rotateBoneAroundWorldAxis(riderBones.head, lateralWorld, headPitch);
    rotateBoneAroundWorldAxis(riderBones.head, forwardWorld, 1.3 * bike.lean);
    root.updateMatrixWorld(true);
    if (backPrintMesh && riderBones.spine2) {
      const riderRotation = riderRoot.getWorldQuaternion(new THREE.Quaternion());
      const backDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(riderRotation).normalize();
      const printWorldPosition = boneWorldPosition(riderBones.spine2)
        .addScaledVector(backDirection, BACK_PRINT_OFFSET);
      printWorldPosition.y += 0.04;
      backPrintMesh.position.copy(riderBones.spine2.worldToLocal(printWorldPosition));
    }
    root.updateMatrixWorld(true);
  }

  return {
    root,
    setHeadlamp(enabled) {
      headlamp.visible = enabled;
    },
    setAssets,
    setWavePose(active, time) {
      wavePoseActive = active;
      wavePoseTime = time;
    },
    startCrash,
    resetCrash,
    getCrashFollowPosition() {
      return crashState?.riderPosition ?? null;
    },
    getAssetStatus() {
      return { ...assetStatus };
    },
    update(bike, input, grade, dt, heightAt) {
      const speed01 = Math.min(1, bike.v / 16);
      const targetPitch = bike.airborne
        ? Math.atan2(bike.vy, Math.max(bike.v, 1)) * 0.6
        : Math.atan(grade);
      const pitch = stepSpring(pitchSpring, targetPitch, dt, 10);
      root.rotation.set(pitch, -(crashState?.heading ?? bike.heading), -bike.lean, 'YXZ');
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
      if (crashState) {
        updateCrash(dt, heightAt);
        if (assetHolder.visible) {
          updateAssetPose(bike, {}, grade, dt, speed01, true);
        }
      } else {
        if (assetHolder.visible) {
          updateAssetPose(bike, input, grade, dt, speed01);
        } else {
          const crouch = bike.jumpCooldown > 0.3
            ? -0.1
            : bike.airborne && bike.jumpCooldown > 0
              ? 0.04
              : bike.airborne
                ? -0.1
                : input.throttle
                  ? -0.02 * Math.sin(cadenceSpring.value * 2)
                  : -0.05;
          const shift = Math.max(0, Math.min(1, bike.brake)) * 0.12;
          fallbackRider.position.y += (crouch - fallbackRider.position.y) * (1 - Math.exp(-10 * dt));
          fallbackRider.position.z += (shift - fallbackRider.position.z) * (1 - Math.exp(-10 * dt));
          fallbackRider.rotation.z = Math.sin(cadenceSpring.value) * 0.04 * (input.throttle ? 1 : 0);
          rearWheel.rotation.x -= (bike.v / WHEEL_R) * dt;
          frontWheel.rotation.x -= (bike.v / WHEEL_R) * dt;
          fallbackSteer.rotation.y = -bike.steer;
          fallbackCrank.rotation.x = cadenceSpring.value;
        }
      }
      root.updateMatrixWorld(true);
      if (!assetHolder.visible && !crashState && wavePoseActive && fallbackWaveChain) {
        const shoulderLocal = new THREE.Vector3(0.18, 1.45, -0.12);
        const waveTargetLocal = shoulderLocal.clone().add(new THREE.Vector3(
          0.30 + Math.sin(wavePoseTime * Math.PI * 4) * 0.12,
          0.50,
          -0.20,
        ));
        const elbowPoleLocal = shoulderLocal.clone().add(new THREE.Vector3(0.55, 0.15, -0.35));
        const target = fallbackRider.localToWorld(waveTargetLocal);
        const pole = fallbackRider.localToWorld(elbowPoleLocal);
        solveTwoBone(root, fallbackWaveChain, target, pole);
        const forwardWorld = new THREE.Vector3(0, 0, -1).transformDirection(fallbackRider.matrixWorld);
        rotateBoneAroundWorldAxis(fallbackWaveHand, forwardWorld, Math.PI / 2);
        root.updateMatrixWorld(true);
      }
    },
  };
}
