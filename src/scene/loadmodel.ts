/**
 * Model loading: packed .fnm meshes (offline pipeline output) and drop-in
 * .glb files (see public/models/README.md). GLB objects are normalized to
 * the caller's target size and centered.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export async function loadPackedGeometry(url: string): Promise<THREE.BufferGeometry> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const view = new DataView(buf);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (magic !== "FNM1") throw new Error(`bad mesh magic in ${url}`);
  const v = view.getUint32(4, true);
  const t = view.getUint32(8, true);
  const positions = new Float32Array(buf, 12, v * 3);
  const indices = new Uint32Array(buf, 12 + v * 12, t * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

/** Probe for a drop-in GLB; resolves null when absent. */
export async function tryLoadGlb(url: string, targetSize: number): Promise<THREE.Object3D | null> {
  try {
    const head = await fetch(url, { method: "HEAD" });
    if (!head.ok) return null;
    const gltf = await new GLTFLoader().loadAsync(url);
    const obj = gltf.scene;
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = targetSize / Math.max(size.x, size.y, size.z, 1e-9);
    obj.scale.setScalar(s);
    obj.position.copy(center).negate().multiplyScalar(s);
    return obj;
  } catch {
    return null;
  }
}
