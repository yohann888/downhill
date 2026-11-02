import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { godRayStrength, speedBlurAmount } from '../src/render/post.js';
import '../src/render/world.js';

describe('postprocessing helpers', () => {
  it('scales speed blur smoothly above its activation threshold', () => {
    expect(speedBlurAmount(0)).toBe(0);
    expect(speedBlurAmount(16)).toBe(0);
    expect(speedBlurAmount(40)).toBeCloseTo(0.014, 8);

    const amounts = [16, 20, 24, 28, 32].map(speedBlurAmount);
    expect(amounts.every((amount, index) => index === 0 || amount > amounts[index - 1])).toBe(true);
  });

  it('only produces god rays when facing the light', () => {
    const forward = new THREE.Vector3(0, 0, -1);
    expect(godRayStrength(forward, new THREE.Vector3(0, 0, -1))).toBe(1);
    expect(godRayStrength(forward, new THREE.Vector3(1, 0, 0))).toBe(0);
    expect(godRayStrength(forward, new THREE.Vector3(0, 0, 1))).toBe(0);
  });

  it('patches the fog shader chunk with height haze', () => {
    expect(THREE.ShaderChunk.fog_fragment).toContain('float hazeBelow =');
    expect(THREE.ShaderChunk.fog_pars_vertex).toContain('varying float vFogWorldY;');
    expect(THREE.ShaderChunk.fog_vertex).toContain('inverse(viewMatrix) * mvPosition');
  });
});
