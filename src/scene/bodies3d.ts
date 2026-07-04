/**
 * Per-body visuals: real-scale mesh (textured sphere or packed shape model),
 * a screen-space dot sprite for when the mesh is sub-pixel, and a CSS2D
 * label. All positions are set per frame in origin-relative km by the scene.
 */
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { BODIES, type BodyDef } from "../data/bodies";
import { loadPackedGeometry, tryLoadGlb } from "./loadmodel";

export interface BodyVisual {
  def: BodyDef;
  group: THREE.Group;
  mesh: THREE.Mesh | null;
  sprite: THREE.Sprite;
  labelEl: HTMLDivElement;
  /** second label line: travel time from the planner origin */
  timeEl: HTMLSpanElement;
}

function dotTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.9)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Procedural station: ring + spokes + hub, real-scale km. Used unless a
 * drop-in models/<id>.glb exists. Original design, no show geometry.
 */
function buildStation(def: BodyDef): THREE.Group {
  const g = new THREE.Group();
  const r = def.radiusKm;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x9aa3ad,
    roughness: 0.6,
    metalness: 0.35,
  });
  const glow = new THREE.MeshBasicMaterial({ color: def.color });

  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.1, 10, 64), mat);
  g.add(ring);
  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.035, r * 0.035, r * 2, 8),
      mat
    );
    spoke.rotation.z = (i * Math.PI) / 4 + Math.PI / 2;
    g.add(spoke);
  }
  // hub: sphere for the Tycho-style construction dock, capsule otherwise
  const hub = new THREE.Mesh(new THREE.SphereGeometry(r * 0.32, 24, 16), mat);
  g.add(hub);
  // docking beacon
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(r * 0.05, 8, 6), glow);
  beacon.position.z = r * 0.4;
  g.add(beacon);
  return g;
}

function buildMesh(
  def: BodyDef,
  texLoader: THREE.TextureLoader,
  base: string
): THREE.Mesh | null {
  if (def.kind === "construct") {
    // the Ring: an unlit thousand-km torus standing on the ecliptic
    const geo = new THREE.TorusGeometry(def.radiusKm, def.radiusKm * 0.045, 12, 96);
    const mat = new THREE.MeshBasicMaterial({ color: def.color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  }
  if (def.model) return null; // swapped in asynchronously

  const geo = new THREE.SphereGeometry(def.radiusKm, 48, 24);
  let mat: THREE.Material;
  if (def.kind === "star") {
    mat = new THREE.MeshBasicMaterial({
      map: def.texture ? loadTex(texLoader, base, def.texture) : null,
      color: 0xffffff,
    });
  } else {
    mat = new THREE.MeshStandardMaterial({
      map: def.texture ? loadTex(texLoader, base, def.texture) : null,
      color: def.texture ? 0xffffff : def.color,
      roughness: 1,
      metalness: 0,
    });
  }
  const mesh = new THREE.Mesh(geo, mat);
  if (def.polarScale) mesh.scale.set(1, 1, def.polarScale);
  // Texture equators map to the ecliptic; axial tilts are ignored in v1
  // (see ASSUMPTIONS.md). Sphere poles default to +Y in three; rotate so
  // poles point at +Z = ecliptic north.
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function loadTex(loader: THREE.TextureLoader, base: string, file: string) {
  const tex = loader.load(`${base}textures/${file}`);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildRing(def: BodyDef, texLoader: THREE.TextureLoader, base: string): THREE.Mesh {
  const { innerKm, outerKm, texture } = def.ring!;
  const geo = new THREE.RingGeometry(innerKm, outerKm, 128);
  // Remap UVs radially so the 1D ring strip texture reads inner->outer.
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    uv.setXY(i, (r - innerKm) / (outerKm - innerKm), 0.5);
  }
  const tex = loadTex(texLoader, base, texture);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  return new THREE.Mesh(geo, mat);
}

export function buildBodies(
  scene: THREE.Scene,
  base: string,
  onLabelClick: (id: string) => void
): Map<string, BodyVisual> {
  const texLoader = new THREE.TextureLoader();
  const dot = dotTexture();
  const visuals = new Map<string, BodyVisual>();

  for (const def of BODIES) {
    const group = new THREE.Group();

    let mesh: THREE.Mesh | null = null;
    if (def.kind === "station") {
      const station = buildStation(def);
      group.add(station);
      // drop-in override: public/models/<id>.glb
      tryLoadGlb(`${base}models/${def.id}.glb`, def.radiusKm * 2.4).then((obj) => {
        if (obj) {
          group.remove(station);
          group.add(obj);
        }
      });
    } else {
      mesh = buildMesh(def, texLoader, base);
      if (mesh) group.add(mesh);
    }
    if (def.ring) group.add(buildRing(def, texLoader, base));

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: dot,
        color: def.color,
        depthWrite: false,
        depthTest: false,
      })
    );
    sprite.renderOrder = 5;
    group.add(sprite);

    const labelEl = document.createElement("div");
    labelEl.className = `body-label kind-${def.kind}`;
    labelEl.style.color = def.color;
    const nameEl = document.createElement("span");
    nameEl.className = "bl-name";
    nameEl.textContent = def.name;
    const timeEl = document.createElement("span");
    timeEl.className = "bl-time";
    labelEl.append(nameEl, timeEl);
    labelEl.addEventListener("click", () => onLabelClick(def.id));
    const label = new CSS2DObject(labelEl);
    label.center.set(-0.08, 1.2);
    group.add(label);

    scene.add(group);
    const visual: BodyVisual = { def, group, mesh, sprite, labelEl, timeEl };
    visuals.set(def.id, visual);

    if (def.model) {
      loadPackedGeometry(`${base}models/${def.model}`).then((geo) => {
        // PDS plate models have inconsistent triangle winding; flat shading
        // with DoubleSide sidesteps both the winding and the vertex-normal
        // artifacts, and reads well on an 89k-facet rock.
        const m = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({
            color: 0x9a8878,
            roughness: 1,
            flatShading: true,
            side: THREE.DoubleSide,
          })
        );
        group.add(m);
        visual.mesh = m;
      });
    }
  }
  return visuals;
}
