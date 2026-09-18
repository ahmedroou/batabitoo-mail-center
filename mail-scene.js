import * as THREE from './vendor/three.module.min.js';

const canvas = document.getElementById('mail-scene');
const card = canvas?.closest('.active-inbox-bar');

if (canvas && card && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  try {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth <= 720 ? 1.25 : 1.7));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
  camera.position.set(0, .15, 8.6);

  scene.add(new THREE.AmbientLight(0xffffff, 2.4));
  const rim = new THREE.DirectionalLight(0x79e7ff, 5);
  rim.position.set(-3, 4, 5);
  scene.add(rim);
  const violet = new THREE.PointLight(0x8f7cff, 18, 14);
  violet.position.set(3, -1, 4);
  scene.add(violet);

  const root = new THREE.Group();
  root.rotation.set(-.16, -.33, -.08);
  scene.add(root);

  const white = new THREE.MeshPhysicalMaterial({ color: 0xf8fbff, roughness: .22, metalness: .06, clearcoat: 1, clearcoatRoughness: .18 });
  const edge = new THREE.MeshPhysicalMaterial({ color: 0x9eeaff, emissive: 0x226c88, emissiveIntensity: .5, roughness: .25, metalness: .15 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x8cf4ff, transparent: true, opacity: .52, blending: THREE.AdditiveBlending });

  const body = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.18, .34, 1, 1, 1), white);
  body.geometry.translate(0, 0, 0);
  root.add(body);

  const flapShape = new THREE.Shape();
  flapShape.moveTo(-1.72, .98);
  flapShape.lineTo(0, -.18);
  flapShape.lineTo(1.72, .98);
  flapShape.closePath();
  const flap = new THREE.Mesh(new THREE.ExtrudeGeometry(flapShape, { depth: .1, bevelEnabled: true, bevelSize: .035, bevelThickness: .035, bevelSegments: 3 }), edge);
  flap.position.set(0, .06, .2);
  root.add(flap);

  const lowerShape = new THREE.Shape();
  lowerShape.moveTo(-1.7, -.98);
  lowerShape.lineTo(0, .23);
  lowerShape.lineTo(1.7, -.98);
  lowerShape.closePath();
  const lower = new THREE.Mesh(new THREE.ExtrudeGeometry(lowerShape, { depth: .08, bevelEnabled: true, bevelSize: .025, bevelThickness: .025, bevelSegments: 2 }), new THREE.MeshPhysicalMaterial({ color: 0xdce8ff, roughness: .32, clearcoat: .7 }));
  lower.position.set(0, 0, .22);
  root.add(lower);

  const seal = new THREE.Mesh(new THREE.CylinderGeometry(.31, .31, .11, 48), new THREE.MeshPhysicalMaterial({ color: 0x6757ff, emissive: 0x2e21d9, emissiveIntensity: .6, metalness: .15, roughness: .25, clearcoat: 1 }));
  seal.rotation.x = Math.PI / 2;
  seal.position.set(0, .05, .42);
  root.add(seal);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.15, .022, 12, 100), glow);
  ring.rotation.set(1.2, .2, -.25);
  root.add(ring);

  const particles = [];
  for (let i = 0; i < 16; i += 1) {
    const particle = new THREE.Mesh(new THREE.IcosahedronGeometry(.025 + Math.random() * .045, 1), glow.clone());
    const angle = (i / 16) * Math.PI * 2;
    particle.position.set(Math.cos(angle) * (2.25 + Math.random() * .65), Math.sin(angle) * (1.2 + Math.random() * .7), (Math.random() - .5) * 1.1);
    particle.userData = { speed: .35 + Math.random() * .65, phase: Math.random() * 6.2 };
    root.add(particle);
    particles.push(particle);
  }

  let targetX = -.16;
  let targetY = -.33;
  card.addEventListener('pointermove', event => {
    const rect = card.getBoundingClientRect();
    targetY = -.33 + ((event.clientX - rect.left) / rect.width - .5) * .36;
    targetX = -.16 + ((event.clientY - rect.top) / rect.height - .5) * .22;
  }, { passive: true });
  card.addEventListener('pointerleave', () => { targetX = -.16; targetY = -.33; }, { passive: true });

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const clock = new THREE.Clock();
  let frame = 0;
  let visible = false;
  let previous = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function draw(now) {
    frame = 0;
    if (!visible || document.hidden || reducedMotion.matches) return;
    frame = requestAnimationFrame(draw);
    if (now - previous < (innerWidth <= 720 ? 32 : 15)) return;
    previous = now;
    const t = clock.getElapsedTime();
    root.position.y = Math.sin(t * 1.05) * .12;
    root.rotation.x += (targetX - root.rotation.x) * .045;
    root.rotation.y += (targetY - root.rotation.y) * .045;
    root.rotation.z = -.08 + Math.sin(t * .72) * .028;
    ring.rotation.z = t * .22;
    particles.forEach(p => {
      const pulse = .75 + Math.sin(t * p.userData.speed * 2 + p.userData.phase) * .35;
      p.scale.setScalar(pulse);
      p.material.opacity = .28 + pulse * .22;
    });
    renderer.render(scene, camera);
    canvas.classList.add('ready');
  }
  function syncAnimation() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    canvas.dataset.animating = String(visible && !document.hidden && !reducedMotion.matches);
    if (canvas.dataset.animating === 'true') frame = requestAnimationFrame(draw);
  }
  function updateVisibility() {
    const rect = card.getBoundingClientRect();
    visible = !canvas.dataset.contextLost && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    syncAnimation();
  }
  new IntersectionObserver(updateVisibility).observe(card);
  new ResizeObserver(updateVisibility).observe(card);
  window.addEventListener('scroll', updateVisibility, { passive: true });
  document.addEventListener('mail-layout-change', updateVisibility);
  updateVisibility();
  document.addEventListener('visibilitychange', syncAnimation);
  reducedMotion.addEventListener('change', syncAnimation);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    visible = false;
    syncAnimation();
    canvas.classList.remove('ready');
    canvas.dataset.contextLost = 'true';
  });
  canvas.addEventListener('webglcontextrestored', () => {
    delete canvas.dataset.contextLost;
    const rect = card.getBoundingClientRect();
    visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
    resize();
    syncAnimation();
  });
  } catch (error) {
    // The CSS envelope remains available when WebGL is unavailable.
    canvas.classList.remove('ready');
    console.warn('Mail illustration fallback:', error.message);
  }
}
