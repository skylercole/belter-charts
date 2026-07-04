/**
 * Per-body visuals: real-scale mesh (textured sphere or packed shape model),
 * a screen-space dot sprite for when the mesh is sub-pixel, and a CSS2D
 * label. All positions are set per frame in origin-relative km by the scene.
 */
import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { BODIES, type BodyDef } from "../data/bodies";
import { loadPackedMesh, tryLoadGlb } from "./loadmodel";
import { proceduralTexture, regolithTexture } from "./proceduraltex";

/** Bodies that get a fresnel atmosphere rim (color, strength). */
const ATMOSPHERES: Record<string, { color: number; strength: number }> = {
  earth: { color: 0x6ab8ff, strength: 1.0 },
  venus: { color: 0xe8c88a, strength: 0.8 },
  mars: { color: 0xd88a5a, strength: 0.45 },
  titan: { color: 0xe8a04a, strength: 1.2 },
};

function atmosphereMesh(radiusKm: number, color: number, strength: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: strength },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = 1.0 - abs(dot(vNormal, vView));
        float a = pow(rim, 3.2) * uStrength;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radiusKm * 1.03, 48, 24), mat);
}

export interface BodyVisual {
  def: BodyDef;
  group: THREE.Group;
  mesh: THREE.Mesh | null;
  sprite: THREE.Sprite;
  labelEl: HTMLDivElement;
  /** the CSS2D object — toggle .visible, not the element's display
   * (CSS2DRenderer overwrites display every frame) */
  label: CSS2DObject;
  /** second label line: travel time from the planner origin */
  timeEl: HTMLSpanElement;
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.5)");
  g.addColorStop(0.6, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
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

/**
 * Earth: day/night shader — daymap lit by the sun direction, city lights
 * emerging across the terminator. uSunDir is world-space, updated per frame
 * by the scene (flagged via userData.isDayNight).
 */
function earthMesh(def: BodyDef, texLoader: THREE.TextureLoader, base: string): THREE.Mesh {
  const day = loadTex(texLoader, base, "earth.jpg");
  const night = loadTex(texLoader, base, "earth_night.jpg");
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tDay: { value: day },
      tNight: { value: night },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    },
    vertexShader: `
      varying vec3 vWorldNormal;
      varying vec2 vUv;
      void main() {
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDay;
      uniform sampler2D tNight;
      uniform vec3 uSunDir;
      varying vec3 vWorldNormal;
      varying vec2 vUv;
      void main() {
        float sunLit = dot(normalize(vWorldNormal), uSunDir);
        float dayF = smoothstep(-0.08, 0.22, sunLit);
        vec3 day = texture2D(tDay, vUv).rgb * (0.08 + 1.25 * max(sunLit, 0.0));
        vec3 night = texture2D(tNight, vUv).rgb * 1.15;
        gl_FragColor = vec4(mix(night, day, dayF), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  mat.userData.isDayNight = true;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.radiusKm, 64, 32), mat);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function buildMesh(
  def: BodyDef,
  texLoader: THREE.TextureLoader,
  base: string
): THREE.Mesh | null {
  if (def.id === "earth") return earthMesh(def, texLoader, base);
  if (def.kind === "construct") {
    // the Ring: emissive gate torus standing on the ecliptic, with a faint
    // glow disc across the aperture
    const geo = new THREE.TorusGeometry(def.radiusKm, def.radiusKm * 0.045, 12, 96);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a3a38,
      emissive: new THREE.Color(def.color),
      emissiveIntensity: 1.6,
      roughness: 0.4,
      metalness: 0.6,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;
    const aperture = new THREE.Mesh(
      new THREE.CircleGeometry(def.radiusKm * 0.96, 64),
      new THREE.MeshBasicMaterial({
        color: def.color,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    mesh.add(aperture);
    return mesh;
  }
  if (def.model) return null; // swapped in asynchronously

  const geo = new THREE.SphereGeometry(def.radiusKm, 48, 24);
  const map = def.texture
    ? loadTex(texLoader, base, def.texture)
    : proceduralTexture(def.id);
  let mat: THREE.Material;
  if (def.kind === "star") {
    mat = new THREE.MeshBasicMaterial({ map, color: 0xffffff });
  } else {
    mat = new THREE.MeshStandardMaterial({
      map,
      color: map ? (def.mapTint ?? 0xffffff) : def.color,
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
    const visual: BodyVisual = { def, group, mesh, sprite, labelEl, label, timeEl };
    visuals.set(def.id, visual);

    if (def.model) {
      loadPackedMesh(`${base}models/${def.model}`).then(({ geometry, unitScale, hasColors }) => {
        // FNM1 (Eros): PDS plate model, inconsistent winding -> flat +
        // DoubleSide. FNM2 (procedural rocks): unit radius, vertex colors,
        // smooth shading.
        const m = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: hasColors ? 0xffffff : 0x9a8878,
            // FNM3 rocks carry UVs: tile the regolith speckle under the
            // vertex colors for close-up surface detail
            map: geometry.getAttribute("uv") ? regolithTexture() : null,
            roughness: 1,
            flatShading: !hasColors,
            side: hasColors ? THREE.FrontSide : THREE.DoubleSide,
            vertexColors: hasColors,
          })
        );
        if (unitScale) m.scale.setScalar(def.radiusKm);
        group.add(m);
        visual.mesh = m;
      });
    }

    // planet extras: atmosphere rim, Earth's cloud layer
    const atmo = ATMOSPHERES[def.id];
    if (atmo) group.add(atmosphereMesh(def.radiusKm, atmo.color, atmo.strength));
    if (def.id === "earth") {
      const clouds = new THREE.Mesh(
        new THREE.SphereGeometry(def.radiusKm * 1.012, 48, 24),
        new THREE.MeshStandardMaterial({
          map: loadTex(texLoader, base, "earth_clouds.jpg"),
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          roughness: 1,
        })
      );
      clouds.rotation.x = Math.PI / 2;
      clouds.name = "clouds";
      group.add(clouds);
    }
    // sun corona glow
    if (def.kind === "star") {
      for (const [size, alpha] of [
        [3.2, 0.55],
        [7.5, 0.22],
      ] as const) {
        const sp = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: glowTexture(),
            color: 0xffd9a0,
            transparent: true,
            opacity: alpha,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        sp.scale.setScalar(def.radiusKm * 2 * size);
        group.add(sp);
      }
    }
  }
  return visuals;
}
