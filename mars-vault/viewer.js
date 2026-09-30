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
const small = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.25 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = Math.pow(2, info.exposure_ev ?? 0.9);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG = new THREE.Color(0xc8b09a);
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

// Ground: unlit, baked textures picked by region, with distance fog.
function tex(name) {
  const t = loader.load(asset(name));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
const groundMat = new THREE.ShaderMaterial({
  uniforms: {
    tCity: { value: tex('ground_city.jpg') }, tNear: { value: tex('ground_near.jpg') }, tFar: { value: tex('ground_far.jpg') },
    city: { value: new THREE.Vector3(...info.city) }, near: { value: new THREE.Vector3(...info.near) },
    far: { value: new THREE.Vector3(...info.far) }, fogColor: { value: FOG }, fogDensity: { value: 1.6e-5 },
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
    uniform sampler2D tCity, tNear, tFar;
    uniform vec3 city, near, far, fogColor;
    uniform float fogDensity;
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
      float f = 1.0 - exp(-pow(d * fogDensity, 1.3));
      gl_FragColor = vec4(mix(c, fogColor, clamp(f, 0.0, 0.95)), 1.0);
      #include <colorspace_fragment>
    }`,
});
groundMat.toneMapped = false;

// Membrane film: translucent, with welded bay seams and Kevlar lines from world position.
function membraneMat() {
  const m = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.25, transparent: true, opacity: 0.22,
                                             side: THREE.DoubleSide, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 q = vec2(vW.x, -vW.z) + 25.0;
        vec2 bay = abs(fract(q / 50.0) - 0.5) * 50.0;           // distance from bay centre
        float seam = smoothstep(24.6, 24.9, max(bay.x, bay.y));
        vec2 k = abs(fract(q / 0.65) - 0.5) * 0.65;
        float fw = fwidth(q.x) * 0.65;
        float kev = (1.0 - smoothstep(0.02, 0.02 + fw, min(k.x, k.y))) * (1.0 - smoothstep(40.0, 400.0, length(vW - cameraPosition)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.55, 0.22), kev * 0.6);
        diffuseColor.a = clamp(diffuseColor.a + seam * 0.45 + kev * 0.25, 0.0, 1.0);`);
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
  if (o.isInstancedMesh) return;
  const key = o.geometry.uuid + '|' + o.material.uuid;
  if (!plain.has(key)) plain.set(key, []);
  plain.get(key).push(o);
});
root.updateMatrixWorld(true);
const hash = (v) => { const s = Math.sin(v.x * 12.9898 + v.z * 78.233) * 43758.5453; return s - Math.floor(s); };
const tints = [0xffffff, 0xf4f0ea, 0xeee4d8, 0xe4d6c8, 0xe2e8e2, 0xfcfbf9, 0xd4d6da, 0xeee0cf].map((c) => new THREE.Color(c));
const TILE = 600;
const tileKey = (p) => Math.floor(p.x / TILE) + ',' + Math.floor(p.z / TILE);

// Chunk instances into ~300 m tiles so frustum culling skips off-screen tiles and
// three.js can draw near tiles first (hidden fragments are rejected by the depth test).
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
    const yaw = Math.atan2(camera.position.x, camera.position.z);
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

for (const [name, parts] of byNode) {
  if (name.startsWith('WEB_anchors')) {
    // Far stand-in: one straight cable plus the cap ring, sized from the real anchor.
    const box = new THREE.Box3();
    parts.forEach((p) => { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); });
    const h = box.max.y - box.min.y, r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
    const cable = new THREE.CylinderGeometry(0.35, 0.35, h, 4, 1, true).translate(0, box.min.y + h / 2, 0);
    const ring = new THREE.TorusGeometry(Math.min(r, 4), 0.35, 3, 12).rotateX(Math.PI / 2).translate(0, box.max.y - 0.5, 0);
    const geo = mergeGeometries([cable.toNonIndexed(), ring.toNonIndexed()]);
    lodGroup(parts, geo, new THREE.MeshStandardMaterial({ color: 0x8a8b8d, metalness: 0.8, roughness: 0.45 }), 350, false);
  } else if (name.startsWith('WEB_people')) {
    // Each pose kind is its own node; LOD each separately with a 2D quad stand-in.
    const quad = new THREE.PlaneGeometry(0.5, 1.75).translate(0, 0.875, 0);
    const shirts = [0xd8d8d8, 0x33477a, 0xa8302a, 0x6d7445, 0xc8781a, 0x2f8a8a, 0x505054, 0xcdb48e].map((c) => new THREE.Color(c));
    const cols = Array.from({ length: parts[0].count }, (_, i) => shirts[i % shirts.length]);
    lodGroup(parts, quad, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }), 120, true, cols);
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
scene.add(root);
document.getElementById('loading').remove();
window.__vault = { renderer, scene, camera, THREE };

// Camera + controls.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxDistance = 60000;
function goTo(c) {
  const p = b2t(c.pos), d = b2t(c.dir).normalize();
  camera.fov = Math.min(Math.max(c.fov, 20), 75);
  camera.updateProjectionMatrix();
  camera.position.copy(p);
  const dist = Math.max(20, p.y * 2);
  controls.target.copy(p).addScaledVector(d, dist);
  controls.update();
}
const sel = document.getElementById('cams');
info.cameras.forEach((c, i) => sel.add(new Option(c.name, i)));
sel.onchange = () => sel.value !== '' && goTo(info.cameras[+sel.value]);
goTo(info.cameras.find((c) => c.name.startsWith('07')) || info.cameras[0]);
updateLods(true);

// Fly mode: WASD/QE + drag to look.
let fly = false;
const keys = new Set();
const flyBtn = document.getElementById('walk');
flyBtn.onclick = () => {
  fly = !fly; controls.enabled = !fly; flyBtn.textContent = fly ? 'Orbit' : 'Fly';
  document.getElementById('help').textContent = fly ? 'WASD move · Q/E down/up · shift faster · drag to look' : 'drag to orbit · scroll to zoom · right-drag to pan';
};
addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
let dragging = false;
renderer.domElement.addEventListener('pointerdown', () => { dragging = true; });
addEventListener('pointerup', () => { dragging = false; });
addEventListener('pointermove', (e) => {
  if (!fly || !dragging) return;
  const eu = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  eu.y -= e.movementX * 0.003; eu.x = Math.max(-1.5, Math.min(1.5, eu.x - e.movementY * 0.003));
  camera.quaternion.setFromEuler(eu);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (fly) {
    const v = new THREE.Vector3((keys.has('d') - keys.has('a')), (keys.has('e') - keys.has('q')), (keys.has('s') - keys.has('w')));
    const speed = (keys.has('shift') ? 120 : 15) * Math.max(1, camera.position.y / 20);
    camera.position.add(v.applyQuaternion(camera.quaternion).multiplyScalar(speed * dt));
  } else controls.update();
  updateLods(false);
  renderer.render(scene, camera);
});
