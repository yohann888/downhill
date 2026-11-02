import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: 0.32 },
    saturation: { value: 1.06 },
    contrast: { value: 1.06 },
    warmth: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette, saturation, contrast, warmth;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);
      c = (c - 0.5) * contrast + 0.5;
      c += vec3(warmth, warmth * 0.4, -warmth);
      c += (1.0 - l) * vec3(0.02, -0.004, 0.034) + l * vec3(0.024, 0.01, -0.014);
      vec2 d = vUv - 0.5;
      c *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    sunScreen: { value: new THREE.Vector2() },
    strength: { value: 0 },
    tint: { value: new THREE.Vector3(1, 0.82, 0.58) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 sunScreen;
    uniform float strength;
    uniform vec3 tint;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 stepUv = (sunScreen - vUv) * (0.9 / 32.0);
      vec2 sampleUv = vUv;
      float decay = 1.0;
      float accumulated = 0.0;
      for (int i = 0; i < 32; i++) {
        sampleUv += stepUv;
        vec3 sampleColor = texture2D(tDiffuse, sampleUv).rgb;
        float luminance = dot(sampleColor, vec3(0.2126, 0.7152, 0.0722));
        accumulated += max(luminance - 0.9, 0.0) * decay;
        decay *= 0.96;
      }
      gl_FragColor = vec4(color.rgb + tint * accumulated * strength, color.a);
    }
  `,
};

const SpeedBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      float mask = smoothstep(0.15, 0.55, length(vUv - 0.5));
      vec2 blurUv = (0.5 - vUv) * amount * mask;
      vec4 color = vec4(0.0);
      for (int i = 0; i < 8; i++) {
        color += texture2D(tDiffuse, vUv + blurUv * (float(i) / 7.0));
      }
      gl_FragColor = color / 8.0;
    }
  `,
};

const smoothstep = (edge0, edge1, value) => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export function speedBlurAmount(speed) {
  return 0.014 * smoothstep(16.7, 30, speed);
}

export function godRayStrength(forward, lightDir) {
  return smoothstep(Math.cos(Math.PI / 3), Math.cos(Math.PI / 12), forward.dot(lightDir));
}

export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.blendIntensity = 0.8;
  gtao.updateGtaoMaterial({
    radius: 0.8,
    distanceExponent: 1,
    thickness: 1,
    scale: 1,
    samples: 12,
    distanceFallOff: 1,
    screenSpaceRadius: false,
  });
  gtao.updatePdMaterial({
    lumaPhi: 10,
    depthPhi: 2,
    normalPhi: 3,
    radius: 4,
    rings: 2,
    samples: 8,
  });
  composer.addPass(gtao);
  const godRays = new ShaderPass(GodRaysShader);
  composer.addPass(godRays);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.22, 0.55, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const speedBlur = new ShaderPass(SpeedBlurShader);
  speedBlur.enabled = false;
  composer.addPass(speedBlur);
  composer.addPass(new ShaderPass(GradeShader));
  const cameraForward = new THREE.Vector3();
  const sunPosition = new THREE.Vector3();
  return {
    render: () => composer.render(),
    setSize: (w, h) => composer.setSize(w, h),
    update({ speed, lightDir, isNight }) {
      camera.updateMatrixWorld();
      camera.getWorldDirection(cameraForward);
      sunPosition.copy(camera.position).addScaledVector(lightDir, 1000).project(camera);
      godRays.uniforms.sunScreen.value.set(
        (sunPosition.x + 1) * 0.5,
        (sunPosition.y + 1) * 0.5,
      );
      godRays.uniforms.strength.value = 0.35
        * godRayStrength(cameraForward, lightDir)
        * (isNight ? 0.6 : 1);
      godRays.uniforms.tint.value.set(
        ...(isNight ? [0.55, 0.75, 1] : [1, 0.82, 0.58]),
      );
      const amount = speedBlurAmount(speed);
      speedBlur.enabled = amount > 0;
      speedBlur.uniforms.amount.value = amount;
    },
  };
}
