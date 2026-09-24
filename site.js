// İnternet sürümü: üst yarıda 3 boyutlu gezinti, alt yarıda fotoğraflar.
// Gezinti kodu Codex_Banyo/mobil/viewer.js'ten sadeleştirilmiştir.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = s => document.querySelector(s);
const ust = $('#ust'), canvas = $('#view'), status = $('#status');
const CACHE_KEY = new URL(import.meta.url).searchParams.get('v') || '';
const asset = path => CACHE_KEY ? `${path}?v=${encodeURIComponent(CACHE_KEY)}` : path;
const SCENES = await fetch(asset('sahneler.json')).then(r => { if (!r.ok) throw new Error('Sahne listesi yüklenemedi'); return r.json(); });
const SLUGS = Object.fromEntries(SCENES.map(c => [c.id, c.slug]));
const chooser = $('#scene');
for (const title of ['planned', 'alternative']) {
  const group = document.createElement('optgroup'); group.label = title === 'planned' ? 'Planlanan seçenekler' : 'Alternatif seçenekler';
  for (const c of SCENES.filter(c => c.layout === title)) { const option = new Option(c.label, String(c.id)); group.append(option); }
  chooser.append(group);
}
function fotograflar(config) {
  if (config.render_ready === false) return ['olculu.svg', 'mobilya_olculeri.svg', 'referans.jpg'];
  return ['perspektif.webp', 'plan.webp', 'olculu.svg', 'referans.jpg'];
}
const HIZ = 0.4; // metre / saniye

// ------------------------------------------------------------ 3 boyutlu sahne
let renderer, dirty = true;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (error) {
  status.textContent = 'Bu tarayıcıda 3 boyutlu görüntü açılamadı.';
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .85;
const world = new THREE.Scene();
world.background = new THREE.Color('#b3b6ac');
const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment(), env = pmrem.fromScene(room, .04);
world.environment = env.texture; room.dispose(); pmrem.dispose();
world.add(new THREE.HemisphereLight(0xfff1d5, 0x55594a, 2));
const sun = new THREE.DirectionalLight(0xffeed5, 2); sun.position.set(0, 4, 2); world.add(sun);
const camera = new THREE.PerspectiveCamera(65, 1, .015, 80); camera.rotation.order = 'YXZ';

function boyutla() {
  const w = ust.clientWidth, h = ust.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true;
}
new ResizeObserver(boyutla).observe(ust);

const loader = new GLTFLoader();
let root = null, yaw = 0, pitch = 0, request = 0, loaded = 0, roofVisible = true;
const keys = new Set(), joy = { x: 0, y: 0 }, vertical = new Map();

function applyLook() { dirty = true; camera.rotation.set(pitch, yaw, 0, 'YXZ'); }
function setRoof(visible) { roofVisible = visible; dirty = true; if (root) root.traverse(o => { if (o.userData.roof) o.visible = visible; }); }
function home() { camera.position.set(.95, 1.50, -.38); yaw = 0; pitch = -.04; applyLook(); setRoof(true); }
function overview() { camera.position.set(1.125, 4.8, -1.37); pitch = -Math.PI / 2 + .001; yaw = 0; applyLook(); setRoof(false); }

function disposeModel(model) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  model.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean)) {
      materials.add(m);
      for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
    }
  });
  geometries.forEach(g => g.dispose());
  textures.forEach(t => { t.source?.data?.close?.(); t.dispose(); });
  materials.forEach(m => m.dispose());
}

async function loadModel(index) {
  const token = ++request;
  status.hidden = false; status.textContent = 'Model yükleniyor…'; resetInputs();
  try {
    const gltf = await loader.loadAsync(asset(`models/${SLUGS[index]}.glb`), e => {
      if (token === request && e.total) status.textContent = `Model yükleniyor · %${Math.round(100 * e.loaded / e.total)}`;
    });
    if (token !== request) { disposeModel(gltf.scene); return; }
    if (root) { world.remove(root); disposeModel(root); }
    root = gltf.scene;
    root.traverse(o => {
      if (!o.isMesh) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = .18; m.depthWrite = false; m.side = THREE.DoubleSide; m.needsUpdate = true; }
        m.envMapIntensity = .65;
      }
    });
    world.add(root); loaded = index; setRoof(roofVisible); status.hidden = true;
  } catch (error) {
    if (token !== request) return;
    status.textContent = 'Model yüklenemedi. Sayfayı yenileyin.';
    console.error(error);
  }
}

// ------------------------------------------------------------ dokunma ve klavye
let look = null;
canvas.addEventListener('pointerdown', e => {
  canvas.focus({ preventScroll: true });
  if (look) return;
  look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (look?.id !== e.pointerId) return;
  yaw -= (e.clientX - look.x) * .004;
  pitch = THREE.MathUtils.clamp(pitch - (e.clientY - look.y) * .004, -1.55, 1.55);
  look.x = e.clientX; look.y = e.clientY; applyLook();
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'])
  canvas.addEventListener(ev, e => { if (look?.id === e.pointerId) look = null; });

const pad = $('#joystick'), stick = $('#stick');
let padPointer = null;
function movePad(e) {
  if (padPointer !== e.pointerId) return;
  const r = pad.getBoundingClientRect(), radius = r.width * .34;
  let x = (e.clientX - r.left - r.width / 2) / radius, y = (e.clientY - r.top - r.height / 2) / radius;
  const length = Math.hypot(x, y);
  if (length > 1) { x /= length; y /= length; }
  joy.x = x; joy.y = y; stick.style.transform = `translate(${x * radius}px,${y * radius}px)`;
}
pad.addEventListener('pointerdown', e => { if (padPointer !== null) return; padPointer = e.pointerId; pad.setPointerCapture(e.pointerId); movePad(e); });
pad.addEventListener('pointermove', movePad);
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'])
  pad.addEventListener(ev, e => { if (padPointer === e.pointerId) { padPointer = null; joy.x = joy.y = 0; stick.style.transform = ''; } });

for (const [id, dir] of [['up', 1], ['down', -1]]) {
  const button = $(`#${id}`);
  button.addEventListener('pointerdown', e => { button.setPointerCapture(e.pointerId); vertical.set(e.pointerId, dir); button.classList.add('active'); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'])
    button.addEventListener(ev, e => { vertical.delete(e.pointerId); button.classList.remove('active'); });
}

function resetInputs() {
  keys.clear(); joy.x = joy.y = 0; vertical.clear(); padPointer = null; look = null; stick.style.transform = '';
  document.querySelectorAll('.active').forEach(e => e.classList.remove('active'));
}
window.addEventListener('blur', resetInputs);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetInputs(); });
const allowed = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
window.addEventListener('keydown', e => { if (!allowed.includes(e.code) || ['SELECT', 'INPUT'].includes(e.target.tagName)) return; e.preventDefault(); keys.add(e.code); });
window.addEventListener('keyup', e => keys.delete(e.code));
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); status.hidden = false; status.textContent = 'Grafik belleği sıfırlandı. Sayfayı yenileyin.'; });

$('#home').onclick = home;
$('#overview').onclick = overview;

let previous = performance.now();
const direction = new THREE.Vector3();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - previous) / 1000, .05); previous = now;
  if (root) {
    const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - joy.y;
    const right = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + joy.x;
    const rise = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0) + [...vertical.values()].reduce((a, b) => a + b, 0);
    direction.set(Math.cos(yaw) * right - Math.sin(yaw) * forward, rise, -Math.sin(yaw) * right - Math.cos(yaw) * forward);
    if (direction.length() > 1) direction.normalize();
    if (direction.lengthSq() > 0) dirty = true;
    camera.position.addScaledVector(direction, HIZ * dt);
    camera.position.clamp(new THREE.Vector3(-6, .05, -9), new THREE.Vector3(8, 9, 6));
  }
  if (dirty && !document.hidden) { renderer.render(world, camera); dirty = false; }
}

// ------------------------------------------------------------ fotoğraflar
const galeri = $('#galeri'), noktalar = $('#noktalar');
const buyutucu = $('#resim-buyutucu'), buyukResim = $('#buyuk-resim');
const resimIsaretleri = new Map();
let resimOlcek = 1, resimX = 0, resimY = 0, oncekiMerkez = null, oncekiUzaklik = 0, tiklamaEngeli = 0;

function resimDonustur() {
  buyukResim.style.transform = `translate3d(${resimX}px,${resimY}px,0) scale(${resimOlcek})`;
}
function resimSifirla() {
  resimOlcek = 1; resimX = resimY = 0; oncekiMerkez = null; oncekiUzaklik = 0; resimIsaretleri.clear(); resimDonustur();
}
async function resmiAc(img) {
  resimSifirla(); buyukResim.src = img.currentSrc || img.src; buyukResim.alt = img.alt; buyutucu.hidden = false;
  try { if (!document.fullscreenElement) await buyutucu.requestFullscreen?.(); } catch { /* Sabit katman zaten ekranı kaplar. */ }
}
async function resmiKapat() {
  buyutucu.hidden = true; buyukResim.removeAttribute('src'); resimSifirla();
  try { if (document.fullscreenElement === buyutucu) await document.exitFullscreen(); } catch { /* CSS görünümü kapanmıştır. */ }
}
function merkezVeUzaklik() {
  const p = [...resimIsaretleri.values()];
  if (p.length < 2) return null;
  return { x:(p[0].x+p[1].x)/2, y:(p[0].y+p[1].y)/2, d:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y) };
}
buyutucu.addEventListener('pointerdown', e => {
  e.preventDefault(); resimIsaretleri.set(e.pointerId,{x:e.clientX,y:e.clientY});
  try { buyutucu.setPointerCapture(e.pointerId); } catch {}
  const pinch=merkezVeUzaklik();
  if(pinch){oncekiMerkez=pinch;oncekiUzaklik=pinch.d;}
});
buyutucu.addEventListener('pointermove', e => {
  const old=resimIsaretleri.get(e.pointerId); if(!old)return; e.preventDefault();
  resimIsaretleri.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const pinch=merkezVeUzaklik();
  if(pinch&&oncekiMerkez){
    const yeni=Math.min(6,Math.max(1,resimOlcek*(pinch.d/Math.max(1,oncekiUzaklik))));
    resimX+=pinch.x-oncekiMerkez.x;resimY+=pinch.y-oncekiMerkez.y;resimOlcek=yeni;oncekiMerkez=pinch;oncekiUzaklik=pinch.d;resimDonustur();tiklamaEngeli=performance.now()+250;
  }else if(resimIsaretleri.size===1&&resimOlcek>1){
    resimX+=e.clientX-old.x;resimY+=e.clientY-old.y;resimDonustur();tiklamaEngeli=performance.now()+250;
  }
});
function resmiBirak(e){
  resimIsaretleri.delete(e.pointerId);const pinch=merkezVeUzaklik();oncekiMerkez=pinch;oncekiUzaklik=pinch?.d||0;
}
for(const ev of ['pointerup','pointercancel','lostpointercapture'])buyutucu.addEventListener(ev,resmiBirak);
buyutucu.addEventListener('click',()=>{if(performance.now()>=tiklamaEngeli)resmiKapat();});
buyutucu.addEventListener('wheel',e=>{e.preventDefault();resimOlcek=Math.min(6,Math.max(1,resimOlcek*Math.exp(-e.deltaY*.002)));if(resimOlcek===1)resimX=resimY=0;resimDonustur();},{passive:false});
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&!buyutucu.hidden)resmiKapat();});

// Yüklenemeyen resmi iki kez daha dener; yine olmazsa dokununca yeniden dener.
function resimYukle(img, src, durum, deneme = 0) {
  img.onload = () => { img.classList.add('hazir'); durum.remove(); };
  img.onerror = () => {
    if (deneme < 2) { setTimeout(() => resimYukle(img, src, durum, deneme + 1), 1500 * (deneme + 1)); return; }
    durum.textContent = 'Yüklenemedi, tekrar denemek için dokunun';
    durum.onclick = () => { durum.textContent = 'Yükleniyor…'; resimYukle(img, src, durum, 0); };
  };
  img.src = deneme ? `${src}${src.includes('?') ? '&' : '?'}tekrar=${Date.now()}` : src;
}

function galeriGoster(index) {
  galeri.replaceChildren(); noktalar.replaceChildren();
  const config = SCENES.find(c => c.id === index);
  for (const ad of fotograflar(config)) {
    const kare = document.createElement('div'); kare.className = 'kare';
    const durum = document.createElement('span'); durum.className = 'durum'; durum.textContent = 'Yükleniyor…';
    const img = document.createElement('img'); img.alt = `${config.label} · ${ad.startsWith('referans') ? 'stil referansı' : ad.split('.')[0]}`; img.decoding = 'async'; img.draggable = false;
    img.addEventListener('click', () => resmiAc(img));
    kare.append(durum, img); galeri.append(kare);
    resimYukle(img, asset(`fotograflar/${SLUGS[index]}_${ad}`), durum);
    noktalar.append(document.createElement('i'));
  }
  galeri.scrollLeft = 0; noktaGuncelle();
}
function noktaGuncelle() {
  const genislik = galeri.firstElementChild?.clientWidth || 1;
  // Sona gelindiyse son resmi seç; geniş ekranda iki resim yan yana durduğu için gerekli.
  const sonda = galeri.scrollLeft + galeri.clientWidth >= galeri.scrollWidth - 2;
  const sira = sonda ? noktalar.children.length - 1 : Math.round(galeri.scrollLeft / genislik);
  [...noktalar.children].forEach((n, i) => n.classList.toggle('secili', i === sira));
}
galeri.addEventListener('scroll', noktaGuncelle, { passive: true });

// ------------------------------------------------------------ banyo seçimi
let secili = 0;
function sec(index) {
  secili = index; chooser.value = String(index);
  document.querySelectorAll('[data-model]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.model) === index)));
  galeriGoster(index);
  loadModel(index);
}
chooser.addEventListener('change', () => sec(Number(chooser.value)));

// Test için salt okunur durum; uzak bir yere veri göndermez.
window.banyoState = () => ({ loaded, position: camera.position.toArray(), yaw, pitch, roofVisible });
window.banyoGalleryState = () => ({ open:!buyutucu.hidden, scale:resimOlcek, x:resimX, y:resimY });

boyutla(); home(); sec(2); requestAnimationFrame(animate);
