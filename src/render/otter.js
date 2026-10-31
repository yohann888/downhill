import * as THREE from 'three';

function makeStickerTexture(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.moveTo(24, 8);
  context.lineTo(488, 8);
  context.quadraticCurveTo(504, 8, 504, 24);
  context.lineTo(504, 232);
  context.quadraticCurveTo(504, 248, 488, 248);
  context.lineTo(24, 248);
  context.quadraticCurveTo(8, 248, 8, 232);
  context.lineTo(8, 24);
  context.quadraticCurveTo(8, 8, 24, 8);
  context.closePath();
  context.fill();
  context.strokeStyle = '#c4ccd2';
  context.lineWidth = 5;
  context.stroke();
  context.fillStyle = '#17232d';
  context.font = 'bold 42px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('made with Devin', 256, 132);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.needsUpdate = true;
  return texture;
}

function installMotionShader(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      uniform float uOtterTime;
      uniform float uOtterWave;
      float otterSmooth(float a, float b, float x) {
        float t = clamp((x - a) / (b - a), 0.0, 1.0);
        return t * t * (3.0 - 2.0 * t);
      }
      vec3 otterRotateZ(vec3 p, float a) {
        float c = cos(a), s = sin(a);
        return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
      }`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `vec3 transformed = vec3(position);
      float pawX = otterSmooth(0.17, 0.3, position.x)
        * (1.0 - otterSmooth(0.38, 0.52, position.x));
      float pawY = otterSmooth(0.36, 0.44, position.y)
        * (1.0 - otterSmooth(0.55, 0.63, position.y));
      float pawFront = otterSmooth(0.02, 0.052, position.z);
      float pawWeight = pawX * pawY * pawFront;
      float worldPhase = dot(modelMatrix[3].xyz, vec3(1.7, 2.3, 3.1));
      transformed.y += sin(uOtterTime * 15.708 + worldPhase) * 0.01 * pawWeight;

      float waveX = otterSmooth(-0.52, -0.4, position.x)
        * (1.0 - otterSmooth(-0.25, -0.13, position.x));
      float waveY = otterSmooth(0.28, 0.36, position.y)
        * (1.0 - otterSmooth(0.51, 0.6, position.y));
      float waveWeight = waveX * waveY * pawFront;
      vec3 wavePivot = vec3(-0.28, 0.49, 0.045);
      vec3 waveOffset = transformed - wavePivot;
      float waveAngle = (-2.35 + sin(uOtterTime * 12.5664) * 0.38) * uOtterWave * waveWeight;
      waveOffset = otterRotateZ(waveOffset, waveAngle);
      transformed = mix(transformed, wavePivot + waveOffset, uOtterWave * waveWeight);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        vec3 c = diffuseColor.rgb;
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float warm = clamp((c.r - c.b) / max(c.r, 1e-4), 0.0, 1.0);
        float fur = smoothstep(0.45, 0.7, warm) * smoothstep(0.006, 0.02, lum);
        vec3 logoOrange = vec3(0.973, 0.371, 0.059) / 0.476;
        diffuseColor.rgb = mix(c, logoOrange * clamp(lum * 2.6, 0.0, 0.48), fur);
      }`,
    );
  };
  material.customProgramCacheKey = () => 'downhill-otter-motion-v2';
  material.needsUpdate = true;
}

export function createOtterStickerMaterial(renderer) {
  const texture = makeStickerTexture(renderer);
  return new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  });
}

export function prepareOtterMesh(mesh, renderer, stickerMaterial) {
  const uniforms = {
    uOtterTime: { value: 0 },
    uOtterWave: { value: 0 },
  };
  const makeMaterial = (source) => {
    const material = source.clone();
    installMotionShader(material, uniforms);
    return material;
  };
  mesh.material = Array.isArray(mesh.material)
    ? mesh.material.map(makeMaterial)
    : makeMaterial(mesh.material);
  const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.155), stickerMaterial);
  sticker.position.set(-0.25, 0.35, 0.063);
  sticker.renderOrder = 2;
  mesh.add(sticker);
  mesh.userData.otterUniforms = uniforms;
  mesh.userData.otterMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mesh.userData.otterSticker = sticker;
  return mesh;
}

export function updateOtterMesh(mesh, time, wave = 0) {
  const uniforms = mesh?.userData.otterUniforms;
  if (!uniforms) return;
  uniforms.uOtterTime.value = time;
  uniforms.uOtterWave.value = wave;
}

export function disposeOtterMesh(mesh) {
  mesh?.userData.otterMaterials?.forEach((material) => material.dispose());
  mesh?.userData.otterSticker?.geometry.dispose();
}
