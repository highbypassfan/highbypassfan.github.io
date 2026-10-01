// Mars Tensile Vault web viewer. Assets come from tools/web_export.py in the
// mars-tensile-vault repo: vault.glb (models + terrain), baked ground_*.jpg, sky.jpg, scene.json.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const base = new URL('.', import.meta.url);
const asset = (p) => new URL(p, base).href;
const info = await (await fetch(asset('scene.json'))).json();

// Blender (Z-up, metres) -> three (Y-up).
const b2t = (v) => new THREE.Vector3(v[0], v[2], -v[1]);

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
const touch = matchMedia('(pointer: coarse)').matches;
const small = touch || Math.min(innerWidth, innerHeight) < 600;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.25 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = Math.pow(2, info.exposure_ev ?? 0.9);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = new THREE.Color(0xc2b3a8);
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 400000);

// Sky: equirectangular Cycles render (world + haze), shown untonemapped.
const loader = new THREE.TextureLoader();
const sky = loader.load(asset('sky.jpg'), (t) => {
  // Image-based lighting / reflections for the 3D models.
  const env = new THREE.PMREMGenerator(renderer).fromEquirectangular(t).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.55;
});
sky.colorSpace = THREE.SRGBColorSpace;
sky.mapping = THREE.EquirectangularReflectionMapping;
{
  const m = new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(300000, 64, 32), m);
  dome.rotation.y = -Math.PI / 2;    // matches the Blender sky camera facing +Y
  dome.renderOrder = -1;
  scene.add(dome);
}

// Lights for the 3D models (the ground has its lighting baked in).
const sunDir = b2t(info.sun_dir).normalize();
const sun = new THREE.DirectionalLight(0xfff0e0, 2.4);
sun.position.copy(sunDir).multiplyScalar(1000);
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xe0cdb8, 0x7a5236, 0.45));

// The sun itself: a small bright disc (Mars sees it ~2/3 the size it is from Earth) with a dusty halo,
// kept at the same direction as the light and following the camera so it stays at infinity.
const sunDisc = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const c = cv.getContext('2d'), g = c.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,250,1)'); g.addColorStop(0.07, 'rgba(255,252,240,1)');
  g.addColorStop(0.1, 'rgba(255,236,205,0.55)'); g.addColorStop(0.3, 'rgba(250,215,175,0.16)');
  g.addColorStop(1, 'rgba(240,200,160,0)');
  c.fillStyle = g; c.fillRect(0, 0, 256, 256);
  const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: 0xffffff, transparent: true, depthWrite: false,
                                                        blending: THREE.AdditiveBlending, toneMapped: false, fog: false }));
  s.material.color.multiplyScalar(1.6);
  s.scale.setScalar(250000 * Math.tan(THREE.MathUtils.degToRad(4.5)));   // halo ~9 deg across, disc ~0.6 deg
  s.renderOrder = -0.5;
  scene.add(s);
  return s;
})();

// Ground: unlit, baked textures picked by region, with distance fog.
function tex(name) {
  const t = loader.load(asset(name));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
// Tiling close-up ground (high-passed render of the Mars surface material, mid-grey = no change).
function detailTex() {
  const t = loader.load(asset('ground_detail.jpg'));
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
const groundMat = new THREE.ShaderMaterial({
  uniforms: {
    tCity: { value: tex('ground_city.jpg') }, tNear: { value: tex('ground_near.jpg') }, tFar: { value: tex('ground_far.jpg') },
    city: { value: new THREE.Vector3(...info.city) }, near: { value: new THREE.Vector3(...info.near) },
    far: { value: new THREE.Vector3(...info.far) }, fogColor: { value: FOG }, fogDensity: { value: 1.6e-5 },
    tDetail: { value: detailTex() }, detailSize: { value: 24.0 },
  },
  vertexShader: /* glsl */`
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tCity, tNear, tFar, tDetail;
    uniform vec3 city, near, far, fogColor;
    uniform float fogDensity, detailSize;
    varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>
    vec2 uvIn(vec3 r, vec2 p) { return (p - r.xy) / r.z; }
    bool inside(vec2 uv) { return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0))); }
    void main() {
      #include <logdepthbuf_fragment>
      vec2 p = vec2(vWorld.x, -vWorld.z);          // Blender XY
      vec2 uc = uvIn(city, p), un = uvIn(near, p), uf = uvIn(far, p);
      vec3 c;
      if (inside(uc)) c = texture2D(tCity, uc).rgb;
      else if (inside(un)) c = texture2D(tNear, un).rgb;
      else c = texture2D(tFar, clamp(uf, 0.0, 1.0)).rgb;
      float d = length(vWorld - cameraPosition);
      // Two tile scales (24 m and ~9 m, rotated) hide the repeat; faded out with distance.
      vec3 d1 = texture2D(tDetail, p / detailSize).rgb * 2.0;
      vec2 r = mat2(0.8, -0.6, 0.6, 0.8) * p;
      vec3 d2 = texture2D(tDetail, r / (detailSize * 0.37) + 0.31).rgb * 2.0;
      c *= mix(vec3(1.0), d1 * mix(vec3(1.0), d2, 0.45), 1.0 - smoothstep(80.0, 600.0, d));
      float f = 1.0 - exp(-pow(d * fogDensity, 1.3));
      gl_FragColor = vec4(mix(c, fogColor, clamp(f, 0.0, 0.95)), 1.0);
      #include <colorspace_fragment>
    }`,
});
groundMat.toneMapped = false;

// Membrane film: tan, fairly opaque and faintly self-lit like the sunlit laminate in the renders,
// with welded bay seams and Kevlar lines from world position.
function membraneMat() {
  const m = new THREE.MeshStandardMaterial({ color: 0xdcc8ad, emissive: 0x5a4632, roughness: 0.55, transparent: true,
                                             opacity: 0.42, side: THREE.DoubleSide, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 q = vec2(vW.x, -vW.z) + 25.0;
        vec2 bay = abs(fract(q / 50.0) - 0.5) * 50.0;           // distance from bay centre
        float seam = smoothstep(24.6, 24.9, max(bay.x, bay.y));
        vec2 k = abs(fract(q / 0.65) - 0.5) * 0.65;
        float fw = length(fwidth(q));
        // Lines while they are resolvable, then their average coverage (no moire), out to ~3 km.
        float line = 1.0 - smoothstep(0.03 - fw, 0.03 + fw, min(k.x, k.y));
        float kev = mix(line, 0.17, smoothstep(0.04, 0.25, fw)) * (1.0 - smoothstep(1500.0, 4000.0, length(vW - cameraPosition)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.55, 0.22), kev * 0.6);
        diffuseColor.a = clamp(diffuseColor.a + seam * 0.35 + kev * 0.2, 0.0, 1.0);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Sunlight transmitted through the film: facets facing the sun glow more (pillow shading from below).
        vec3 nW = normalize(cross(dFdx(vW), dFdy(vW)));
        float tr = abs(dot(nW, uSun));
        totalEmissiveRadiance *= 0.35 + 1.6 * tr * tr;`)
      .replace('#include <common>', '#include <common>\nuniform vec3 uSun;');
    sh.uniforms.uSun = { value: sunDir };
  };
  return m;
}

// Load models.
const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(asset('vault.glb'));
const root = gltf.scene;
const film = membraneMat();
const plain = new Map();   // geometry+material -> meshes, to convert repeats into InstancedMesh

root.traverse((o) => {
  if (!o.isMesh) return;
  const n = (o.parent?.name || '') + ' ' + o.name;
  if (n.includes('WEB_TERRAIN')) { o.material = groundMat; return; }
  if (n.includes('membrane')) { o.material = film; o.renderOrder = 2; return; }
  // Farm substation: keep only the white equipment enclosures (no fence, poles, gantries or pad).
  if (/Solar_farm_substation/.test(n) && !/enclosure/i.test(o.material.name)) { o.visible = false; return; }
  if (o.isInstancedMesh) return;
  const key = o.geometry.uuid + '|' + o.material.uuid;
  if (!plain.has(key)) plain.set(key, []);
  plain.get(key).push(o);
});
root.updateMatrixWorld(true);

// Terrain height lookup (Blender XY -> height) from the near terrain grid, for walking and the solar rows.
const H = (() => {
  let mesh = null;
  root.traverse((o) => { if (o.isMesh && /TERRAIN_?near/i.test(o.name + ' ' + (o.parent?.name || ''))) mesh = o; });
  const [x0, y0, size] = info.near;
  if (!mesh) return () => 0;
  const pos = mesh.geometry.attributes.position, v = new THREE.Vector3();
  const n = Math.round(Math.sqrt(pos.count)) - 1, step = size / n, r = n + 1;
  const grid = new Float32Array(r * r);
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k).applyMatrix4(mesh.matrixWorld);
    const i = Math.round((v.x - x0) / step), j = Math.round((-v.z - y0) / step);
    if (i >= 0 && j >= 0 && i <= n && j <= n) grid[j * r + i] = v.y;
  }
  return (bx, by) => {
    const fx = (bx - x0) / step, fy = (by - y0) / step;
    if (fx < 0 || fy < 0 || fx >= n || fy >= n) return 0;
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const a = grid[j * r + i], b = grid[j * r + i + 1], c = grid[(j + 1) * r + i], d = grid[(j + 1) * r + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
})();

const hash = (v) => { const s = Math.sin(v.x * 12.9898 + v.z * 78.233) * 43758.5453; return s - Math.floor(s); };
const tints = [0xffffff, 0xf4f0ea, 0xeee4d8, 0xe4d6c8, 0xe2e8e2, 0xfcfbf9, 0xd4d6da, 0xeee0cf].map((c) => new THREE.Color(c));
const TILE = 600;
const tileKey = (p) => Math.floor(p.x / TILE) + ',' + Math.floor(p.z / TILE);

// Chunk instances into tiles so frustum culling skips off-screen tiles and three.js can
// draw near tiles first (hidden fragments are then rejected by the depth test).
function chunked(geometry, material, matrices, colors, name) {
  const tiles = new Map();
  const p = new THREE.Vector3();
  matrices.forEach((m, i) => {
    p.setFromMatrixPosition(m);
    const k = tileKey(p);
    if (!tiles.has(k)) tiles.set(k, []);
    tiles.get(k).push(i);
  });
  for (const ids of tiles.values()) {
    const im = new THREE.InstancedMesh(geometry, material, ids.length);
    im.name = name;
    ids.forEach((id, j) => {
      im.setMatrixAt(j, matrices[id]);
      if (colors) im.setColorAt(j, colors[id]);
    });
    im.computeBoundingSphere();
    scene.add(im);
  }
}

// Plain repeated meshes (homes, halls, tanks) -> chunked instances with facade tints.
for (const meshes of plain.values()) {
  if (meshes.length < 4) continue;
  const facade = /facade|cladding/i.test(meshes[0].material.name);
  const mats = meshes.map((m) => m.matrixWorld.clone());
  const cols = facade ? meshes.map((m) => tints[Math.floor(hash(m.getWorldPosition(new THREE.Vector3())) * tints.length)]) : null;
  chunked(meshes[0].geometry, meshes[0].material, mats, cols, meshes[0].name);
  meshes.forEach((m) => m.removeFromParent());
}

// glTF instanced groups: anchors and people get distance LODs, freight/airlocks are chunked.
const byNode = new Map();
root.traverse((o) => {
  if (!o.isInstancedMesh) return;
  let n = o; while (n.parent && n.parent !== root) n = n.parent;     // top-level export node
  const k = n.name;
  if (!byNode.has(k)) byNode.set(k, []);
  byNode.get(k).push(o);
});
const readMatrices = (im) => Array.from({ length: im.count }, (_, i) => { const m = new THREE.Matrix4(); im.getMatrixAt(i, m); return m.premultiply(im.matrixWorld); });

const lods = [];
function lodGroup(parts, farGeometry, farMaterial, range, billboard, farColors) {
  const all = readMatrices(parts[0]);
  const near = parts.map((im) => {
    const m = new THREE.InstancedMesh(im.geometry, im.material, all.length);
    m.count = 0; m.frustumCulled = false; scene.add(m); im.removeFromParent(); return m;
  });
  const far = new THREE.InstancedMesh(farGeometry, farMaterial, all.length);
  far.frustumCulled = false; scene.add(far);
  const pos = all.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
  lods.push({ all, pos, near, far, range, billboard, farColors, last: new THREE.Vector3(1e9, 0, 0) });
}
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
function updateLods(force) {
  for (const L of lods) {
    if (!force && L.last.distanceToSquared(camera.position) < 25) continue;
    L.last.copy(camera.position);
    let n = 0, f = 0;
    for (let i = 0; i < L.all.length; i++) {
      const d = L.pos[i].distanceTo(camera.position);
      if (d < L.range) { for (const m of L.near) m.setMatrixAt(n, L.all[i]); n++; }
      else {
        if (L.billboard) {
          L.all[i].decompose(tmpP, tmpQ, tmpS);
          const a = Math.atan2(camera.position.x - tmpP.x, camera.position.z - tmpP.z);
          tmpM.compose(tmpP, tmpQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a), tmpS);
          L.far.setMatrixAt(f, tmpM);
        } else L.far.setMatrixAt(f, L.all[i]);
        if (L.farColors) L.far.setColorAt(f, L.farColors[i]);
        f++;
      }
    }
    for (const m of L.near) { m.count = n; m.instanceMatrix.needsUpdate = true; }
    L.far.count = f; L.far.instanceMatrix.needsUpdate = true;
    if (L.far.instanceColor) L.far.instanceColor.needsUpdate = true;
  }
}

// Far anchor stand-in: main cable up to the splay point, the six branch wires out to the cap
// ring, and the ring, all measured from the real anchor so the LOD swap is hard to spot.
function anchorStandIn(parts) {
  const box = new THREE.Box3();
  parts.forEach((p) => { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); });
  const top = box.max.y, bot = box.min.y, v = new THREE.Vector3();
  let rRing = 0, ySplay = bot;
  const angles = [];
  for (const p of parts) {
    const pos = p.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const rad = Math.hypot(v.x, v.z);
      if (v.y > top - 1.5) rRing = Math.max(rRing, rad);
      if (rad < 0.6 && v.y < top - 1.5 && v.y > bot + 2) ySplay = Math.max(ySplay, v.y);
      if (rad > 0.8 && v.y < top - 1.5 && v.y > bot + 2) angles.push(Math.atan2(v.z, v.x));
    }
  }
  rRing = Math.min(rRing, 4.2) - 0.3;
  // Wire phase: circular mean of the wire vertices' angles modulo 60 degrees.
  let sx = 0, sy = 0;
  for (const a of angles) { sx += Math.cos(a * 6); sy += Math.sin(a * 6); }
  const phase = angles.length ? Math.atan2(sy, sx) / 6 : 0;
  const geos = [];
  const cable = new THREE.CylinderGeometry(0.33, 0.33, ySplay - bot, 4, 1, true).translate(0, (bot + ySplay) / 2, 0);
  geos.push(cable.toNonIndexed());
  const a = new THREE.Vector3(0, ySplay, 0), up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion();
  for (let k = 0; k < 6; k++) {
    const t = phase + k * Math.PI / 3;
    const b = new THREE.Vector3(Math.cos(t) * rRing, top - 0.4, Math.sin(t) * rRing);
    const d = b.clone().sub(a), len = d.length();
    const w = new THREE.CylinderGeometry(0.12, 0.12, len, 3, 1, true);
    w.applyQuaternion(q.setFromUnitVectors(up, d.normalize()));
    w.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    geos.push(w.toNonIndexed());
  }
  geos.push(new THREE.TorusGeometry(rRing, 0.3, 3, 18).rotateX(Math.PI / 2).translate(0, top - 0.4, 0).toNonIndexed());
  return mergeGeometries(geos);
}

// 2D person stand-in: a simple silhouette; the white shirt area takes the instance colour.
function personStandIn() {
  const cv = document.createElement('canvas'); cv.width = 32; cv.height = 112;
  const c = cv.getContext('2d');
  c.fillStyle = '#c69a7c'; c.beginPath(); c.arc(16, 9, 7, 0, 7); c.fill();              // head
  c.fillStyle = '#ffffff'; c.beginPath(); c.roundRect(5, 17, 22, 40, 6); c.fill();      // shirt
  c.fillRect(1, 20, 5, 32); c.fillRect(26, 20, 5, 32);                                  // sleeves
  c.fillStyle = '#2e3138'; c.fillRect(7, 55, 8, 52); c.fillRect(17, 55, 8, 52);        // legs
  c.fillStyle = '#1a1a1c'; c.fillRect(6, 104, 10, 8); c.fillRect(16, 104, 10, 8);      // shoes
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, roughness: 0.85, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `
      #ifdef USE_INSTANCING_COLOR
        diffuseColor.rgb = mix(diffuseColor.rgb, vColor, step(0.97, min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b))));
      #endif`);
  };
  return m;
}

for (const [name, parts] of byNode) {
  if (name.startsWith('WEB_anchors')) {
    lodGroup(parts, anchorStandIn(parts), new THREE.MeshStandardMaterial({ color: 0x8a8b8d, metalness: 0.8, roughness: 0.45 }), 650, false);
  } else if (name.startsWith('WEB_people')) {
    // Crowd: camera-facing 2D stand-ins at every distance (only the observer is a full model).
    const quad = new THREE.PlaneGeometry(0.5, 1.75).translate(0, 0.875, 0);
    const shirts = [0xd8d8d8, 0x33477a, 0xa8302a, 0x6d7445, 0xc8781a, 0x2f8a8a, 0x505054, 0xcdb48e].map((c) => new THREE.Color(c));
    const cols = Array.from({ length: parts[0].count }, (_, i) => shirts[i % shirts.length]);
    lodGroup(parts, quad, personStandIn(), -1, true, cols);
  } else if (name.startsWith('WEB_freight')) {
    // Box imposters: side and top renders of the real pallet load mapped onto its bounding box.
    for (const im of parts) {
      im.geometry.computeBoundingBox();
      const bb = im.geometry.boundingBox, size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
      const geo = new THREE.BoxGeometry(size.x, size.y, size.z).translate(c.x, c.y, c.z);
      // Instanced export drops mesh names, so identify the cargo type by material (and size).
      const mn = im.material.name || '';
      const kind = /protective wrap/.test(mn) ? (size.y < 1.2 ? 0 : 1) : /metal|drum|shell/.test(mn) ? 2
        : /hot-rolled/.test(mn) ? 3 : /galvanised pipe/.test(mn) ? 4 : /bulk bag/.test(mn) ? 5
        : /sintered/.test(mn) ? 6 : /aluminium ingot/.test(mn) ? 7
        : /Forklift/.test(mn) ? (Math.max(size.x, size.z) > 3.3 ? 9 : 8) : null;
      let mat = im.material;
      if (kind !== null) {
        const side = new THREE.MeshStandardMaterial({ map: tex(`freight_${kind}_side.jpg`), roughness: 0.75 });
        const top = new THREE.MeshStandardMaterial({ map: tex(`freight_${kind}_top.jpg`), roughness: 0.75 });
        mat = [side, side, top, side, side, side];
      }
      chunked(geo, mat, readMatrices(im), null, name);
      im.removeFromParent();
    }
  } else {
    for (const im of parts) {
      chunked(im.geometry, im.material, readMatrices(im), null, name);
      im.removeFromParent();
    }
  }
}

// Solar farm: east/west tent rows generated from the same layout rules as the Blender scene
// (tools/legacy/photoreal_solar.py), laid on the terrain.
{
  const F = info.solar, tilt = THREE.MathUtils.degToRad(F.tilt_deg);
  const run = F.panel * Math.cos(tilt), ridge = F.low + F.panel * Math.sin(tilt), half = F.seg / 2;
  const P = [], U = [];
  for (const sgn of [-1, 1]) {            // two sloped module rows meeting at the ridge
    const q = [[sgn * run, F.low, -half, 0, 0], [0, ridge, -half, 0, 1], [0, ridge, half, F.seg, 1], [sgn * run, F.low, half, F.seg, 0]];
    for (const k of [0, 1, 2, 0, 2, 3]) { P.push(q[k][0], q[k][1], q[k][2]); U.push(q[k][3], q[k][4]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.computeVertexNormals();
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#9a9ca0'; cx.fillRect(0, 0, 64, 128);                    // module frame
  for (let r = 0; r < 12; r++) for (let c = 0; c < 6; c++) {
    cx.fillStyle = (r + c) % 2 ? '#0b1430' : '#0e1838';
    cx.fillRect(3 + c * 9.7, 3 + r * 10.2, 8.9, 9.4);
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace; map.wrapS = THREE.RepeatWrapping; map.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map, color: 0xd9c9b8, roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide });
  const w = F.x1 - F.x0, h = F.y1 - F.y0;
  const nx = Math.floor(w / F.pitch), ny = Math.floor(h / F.seg), dx = w / (nx - 1), dy = h / (ny - 1);
  const band = (c, period, hw, off) => { const f = ((c - off) % period + period) % period; return Math.min(f, period - f) < hw; };
  const mats = [], e = new THREE.Euler(), m = new THREE.Matrix4();
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = F.x0 + i * dx, y = F.y0 + j * dy;
    if (band(y, F.track_every, F.track_half, F.y0 + F.track_every / 2) || band(x, w / 2, F.spine_half, F.x0 + w / 2)) continue;
    // Fit a line through the terrain along the segment, then lift it to clear every sample
    // (the rendered terrain triangulates its grid differently from this bilinear lookup).
    const z0 = H(x, y - half), z1 = H(x, y + half), zc = (z0 + z1) / 2;
    let lift = 0;
    for (const t of [-1, -0.5, 0, 0.5, 1]) for (const ox of [-run, 0, run]) {
      lift = Math.max(lift, H(x + ox, y + t * half) - (zc + (z1 - z0) / 2 * t));
    }
    const pitch = Math.atan2(z1 - z0, F.seg);
    m.makeRotationFromEuler(e.set(pitch, 0, 0)).setPosition(x, zc + lift + 0.12, -y);
    mats.push(m.clone());
  }
  chunked(g, mat, mats, null, 'solar rows');
  // Inverter skids at the track junctions.
  const skid = new THREE.BoxGeometry(7.8, 2.9, 2.8).translate(0, 1.45, 0);
  const nkx = Math.floor(w / F.skid_every), nky = Math.floor(h / F.skid_every);
  const sx = (w - F.skid_every) / (nkx - 1), sy = (h - F.skid_every) / (nky - 1);
  const skids = [];
  for (let j = 0; j < nky; j++) for (let i = 0; i < nkx; i++) {
    const x = F.x0 + F.skid_every / 2 + i * sx, y = F.y0 + F.skid_every / 2 + j * sy;
    skids.push(new THREE.Matrix4().setPosition(x, H(x, y), -y));
  }
  chunked(skid, new THREE.MeshStandardMaterial({ color: 0xb8b8b4, roughness: 0.5 }), skids, null, 'inverter skids');
}
scene.add(root);
document.getElementById('loading').remove();
window.__vault = { renderer, scene, camera, THREE, lods };

// Camera + controls.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxDistance = 60000;
const EYE = 1.7;
const ground = (p) => H(p.x, -p.z);
function goTo(c) {
  const p = b2t(c.pos), d = b2t(c.dir).normalize();
  camera.fov = Math.min(Math.max(c.fov, 20), 75);
  camera.updateProjectionMatrix();
  camera.position.copy(p);
  const dist = Math.max(20, (p.y - ground(p)) * 2);
  controls.target.copy(p).addScaledVector(d, dist);
  controls.update();
  camera.lookAt(p.clone().add(d));
}
// Start: standing on the ground a few metres behind the observer in the SpaceX shirt.
function behindObserver() {
  const o = info.observer;
  if (!o) return goTo(info.cameras.find((c) => c.name.startsWith('01')) || info.cameras[0]);
  const feet = b2t(o.pos), fwd = b2t(o.forward).normalize();
  camera.fov = 60; camera.updateProjectionMatrix();
  camera.position.copy(feet).addScaledVector(fwd, -3.2);
  camera.position.x += fwd.z * 0.6; camera.position.z -= fwd.x * 0.6;     // a little off his shoulder
  camera.position.y = ground(camera.position) + EYE;
  camera.lookAt(feet.clone().addScaledVector(fwd, 30).setY(feet.y + 9));
}

// Modes: Walk / fly (walk on the ground; E / space or the up button takes off and you fly where
// you look; Q / C or the down button lands) and Orbit. The camera never goes below the ground.
const MODES = ['Walk / fly', 'Orbit'];
const HELP = {
  'Walk / fly': 'WASD move · E/space up · Q/C down · shift faster · drag to look',
  Orbit: 'drag to orbit · scroll to zoom · right-drag to pan',
};
let mode = MODES[0];
const keys = new Set();
const modeBtn = document.getElementById('walk');
const pads = document.getElementById('pads');
// land: switching into Walk / fly from Orbit puts you on the ground, standing.
function setMode(next, land = false) {
  mode = next;
  controls.enabled = mode === 'Orbit';
  if (mode === 'Orbit') {            // orbit around a point ahead of the current view
    const ahead = Math.max(20, (camera.position.y - ground(camera.position)) * 1.5);
    controls.target.copy(camera.position).add(new THREE.Vector3(0, 0, -ahead).applyQuaternion(camera.quaternion));
    controls.update();
  } else {
    const eu = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); eu.z = 0;
    if (land) { eu.x = Math.max(-0.3, Math.min(0.5, eu.x)); camera.position.y = ground(camera.position) + EYE; }
    camera.quaternion.setFromEuler(eu);
  }
  modeBtn.textContent = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  document.getElementById('help').textContent = touch && mode !== 'Orbit' ? 'left stick look · right stick move · ▲▼ up/down' : HELP[mode];
  pads.hidden = !(touch && mode !== 'Orbit');
}
modeBtn.onclick = () => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length], true);
const sel = document.getElementById('cams');
sel.add(new Option('Behind the observer (start)', 'start'));
info.cameras.forEach((c, i) => sel.add(new Option(c.name, i)));
sel.onchange = () => {
  if (sel.value === 'start') behindObserver();
  else if (sel.value !== '') goTo(info.cameras[+sel.value]);
  setMode(mode);
};
behindObserver();
setMode(MODES[0]);
updateLods(true);

addEventListener('keydown', (e) => {
  if (e.target === document.body || e.target === renderer.domElement) {
    keys.add(e.key.toLowerCase());
    if (e.key === ' ') e.preventDefault();
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
function look(dx, dy) {
  const eu = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  eu.y -= dx; eu.x = Math.max(-1.5, Math.min(1.5, eu.x - dy)); eu.z = 0;
  camera.quaternion.setFromEuler(eu);
}
let dragging = false;
renderer.domElement.addEventListener('pointerdown', () => { dragging = true; });
addEventListener('pointerup', () => { dragging = false; });
addEventListener('pointermove', (e) => { if (mode !== 'Orbit' && dragging) look(e.movementX * 0.003, e.movementY * 0.003); });

// Joysticks: each returns a vector in [-1, 1]^2 while held.
function stick(el) {
  const knob = el.querySelector('.knob'), v = { x: 0, y: 0 }, R = 50;
  let id = null, cx = 0, cy = 0;
  const move = (e) => {
    if (e.pointerId !== id) return;
    let x = e.clientX - cx, y = e.clientY - cy;
    const l = Math.hypot(x, y);
    if (l > R) { x *= R / l; y *= R / l; }
    v.x = x / R; v.y = y / R;
    knob.style.transform = `translate(${x}px, ${y}px)`;
  };
  const end = (e) => { if (e.pointerId !== id) return; id = null; v.x = v.y = 0; knob.style.transform = ''; };
  el.addEventListener('pointerdown', (e) => {
    id = e.pointerId; el.setPointerCapture(id);
    const r = el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    move(e); e.preventDefault(); e.stopPropagation();
  });
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  return v;
}
const lookStick = stick(document.getElementById('lookPad'));
const moveStick = stick(document.getElementById('movePad'));
function held(id) {
  const s = { on: false }, el = document.getElementById(id);
  el.addEventListener('pointerdown', (e) => { s.on = true; el.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation(); });
  for (const t of ['pointerup', 'pointercancel']) el.addEventListener(t, () => { s.on = false; });
  return s;
}
const upBtn = held('upBtn'), downBtn = held('downBtn');

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});
const clock = new THREE.Clock();
const fwd = new THREE.Vector3(), side = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (mode === 'Orbit') {
    controls.update();
    const g = ground(camera.position) + 1.0;           // keep the orbit camera above the ground
    if (camera.position.y < g) { camera.position.y = g; camera.lookAt(controls.target); }
  } else {
    look(lookStick.x * 1.8 * dt, lookStick.y * 1.4 * dt);
    const kx = keys.has('d') - keys.has('a') + moveStick.x, kz = keys.has('w') - keys.has('s') - moveStick.y;
    const ky = (keys.has('e') || keys.has(' ') || upBtn.on) - (keys.has('q') || keys.has('c') || downBtn.on);
    const run = keys.has('shift') || Math.hypot(moveStick.x, moveStick.y) > 0.95;
    const alt = camera.position.y - (ground(camera.position) + EYE);
    const walking = alt < 0.5 && ky <= 0;
    camera.getWorldDirection(fwd);
    if (walking) fwd.y = 0;                             // on the ground: walk level and follow the terrain
    fwd.normalize();
    side.crossVectors(fwd, camera.up).normalize();
    const speed = (walking ? 1.8 : Math.max(4, alt * 0.8)) * (run ? 4 : 1);
    camera.position.addScaledVector(fwd, kz * speed * dt).addScaledVector(side, kx * speed * dt);
    camera.position.y += ky * Math.max(3, alt * 0.8) * (run ? 4 : 1) * dt;
    const floor = ground(camera.position) + EYE;
    if (walking || camera.position.y < floor) camera.position.y = floor;
  }
  updateLods(false);
  sunDisc.position.copy(camera.position).addScaledVector(sunDir, 250000);
  renderer.render(scene, camera);
});
