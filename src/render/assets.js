import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export async function loadModels(names) {
  const debug = new URLSearchParams(window.location.search).has('debug');
  const entries = await Promise.all(
    names.map(async (name) => {
      try {
        const gltf = await loader.loadAsync(`./assets/models/${name}.glb`);
        return [name, gltf];
      } catch (error) {
        if (debug) {
          window.__assetLoadErrors ??= {};
          window.__assetLoadErrors[name] = error instanceof Error ? error.message : String(error);
        }
        return [name, null];
      }
    }),
  );
  return Object.fromEntries(entries.filter(([, gltf]) => gltf));
}

// First mesh of a GLB as one geometry, base centered at the origin, scaled so `axis` spans 1.
export function unitMesh(gltf, axis = 'y') {
  let found = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { if (!found && o.isMesh) found = o; });
  if (!found) return null;
  const geometry = found.geometry.clone().applyMatrix4(found.matrixWorld);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const size = box.getSize(new THREE.Vector3());
  const span = axis === 'xz' ? Math.max(size.x, size.z) : size[axis];
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  geometry.scale(1 / span, 1 / span, 1 / span);
  geometry.computeBoundingBox();
  return { geometry, material: found.material };
}
