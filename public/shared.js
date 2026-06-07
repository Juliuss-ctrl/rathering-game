// ── Utilities ─────────────────────────────
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

async function apiRequest(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error(`API Error (${url}):`, err);
    throw err;
  }
}

function initStarfield() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, stars = [];

  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }

  function init() {
    resize();
    stars = Array.from({length: 120}, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.2 + 0.2,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.006 + 0.002,
    }));
  }

  let t = 0;
  function draw() {
    ctx.clearRect(0, 0, W, H);
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';

    // Background
    ctx.fillStyle = isLight ? '#f4f4f8' : '#0c0c0e';
    ctx.fillRect(0, 0, W, H);

    // Orbs
    const orbs = isLight ? [
      { x: W*0.1, y: H*0.15, r: 400, color: 'rgba(99,102,241,0.06)' },
      { x: W*0.9, y: H*0.8,  r: 350, color: 'rgba(139,92,246,0.04)' },
    ] : [
      { x: W*0.1, y: H*0.15, r: 400, color: 'rgba(99,102,241,0.08)' },
      { x: W*0.9, y: H*0.8,  r: 350, color: 'rgba(139,92,246,0.06)' },
      { x: W*0.5, y: H*1.1,  r: 500, color: 'rgba(16,185,129,0.03)' },
    ];

    orbs.forEach(o => {
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
      g.addColorStop(0, o.color); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    });

    // Stars (only dark mode)
    if (!isLight) {
      t += 0.01;
      stars.forEach(s => {
        const f = 0.2 + 0.8 * Math.sin(t * s.speed * 60 + s.phase);
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200,200,255,${f * 0.5})`; ctx.fill();
      });
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  init(); draw();
}

// ── Theme toggle ──────────────────────────
function initThemeToggle() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);

  const btn = document.createElement('button');
  btn.id = 'theme-toggle';
  btn.innerHTML = saved === 'dark' ? '☀️' : '🌙';
  btn.title = 'Theme wechseln';
  document.body.appendChild(btn);

  btn.onclick = () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    btn.innerHTML = next === 'dark' ? '☀️' : '🌙';
  };
}

// ── Toast ─────────────────────────────────
function showToast(msg, duration = 2600) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), duration);
}

// ── Session ───────────────────────────────
const Session = {
  set: (k, v) => sessionStorage.setItem(k, JSON.stringify(v)),
  get: (k) => { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  clear: () => sessionStorage.clear(),
};

function getPlayerId() {
  let id = localStorage.getItem('ratheringPlayerId');
  if (!id) {
    const random = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    id = `player:${random}`;
    localStorage.setItem('ratheringPlayerId', id);
  }
  return id;
}

// ── Avatars ───────────────────────────────
function escapeAvatarHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function hashAvatarSeed(seed) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isIdenticonAvatar(avatar) {
  return typeof avatar === 'string' && avatar.startsWith('identicon:');
}

function identiconSvg(avatar) {
  const seed = avatar || 'identicon:default';
  const hash = hashAvatarSeed(seed);
  const hue = hash % 360;
  const accent = `hsl(${hue} 78% 58%)`;
  const accent2 = `hsl(${(hue + 42) % 360} 72% 46%)`;
  const dark = `hsl(${(hue + 210) % 360} 34% 18%)`;
  const cells = [];

  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      const bit = (hash >> ((x + y * 3) % 24)) & 1;
      if (!bit) continue;
      const color = ((x + y) % 3 === 0) ? accent2 : accent;
      cells.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`);
      if (x !== 2) cells.push(`<rect x="${4 - x}" y="${y}" width="1" height="1" fill="${color}"/>`);
    }
  }

  return `<svg class="identicon-svg" viewBox="0 0 5 5" aria-hidden="true" focusable="false">
    <rect width="5" height="5" rx="1" fill="${dark}"/>
    ${cells.join('')}
  </svg>`;
}

function avatarHtml(avatar, fallback = '🙂') {
  if (isIdenticonAvatar(avatar)) return identiconSvg(avatar);
  return escapeAvatarHtml(avatar || fallback);
}

function renderAvatarElement(element, avatar, fallback = '🙂') {
  if (!element) return;
  element.innerHTML = avatarHtml(avatar, fallback);
}

function initAvatarPickerOptions() {
  document.querySelectorAll('.avatar-option[data-avatar]').forEach(button => {
    renderAvatarElement(button, button.dataset.avatar);
  });
}

// ── Sound ─────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let _actx = null;
function getAudioCtx() { if (!_actx) _actx = new AudioCtx(); return _actx; }
function playTone(hz, ms, vol = 0.12) {
  try {
    const ctx = getAudioCtx(), osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = hz; osc.type = 'sine';
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + ms / 1000);
  } catch {}
}
function soundClick()  { playTone(800, 40, 0.08); }
function soundVote()   { playTone(600, 80, 0.12); setTimeout(() => playTone(900, 60, 0.08), 80); }
function soundStart()  { playTone(500, 80, 0.10); setTimeout(() => playTone(630, 80, 0.10), 90); setTimeout(() => playTone(750, 120, 0.12), 180); }
function soundResult() { playTone(750, 100, 0.12); setTimeout(() => playTone(940, 100, 0.12), 110); setTimeout(() => playTone(1120, 180, 0.14), 220); }
function soundTimeUp() { playTone(220, 140, 0.14); setTimeout(() => playTone(165, 180, 0.14), 150); }
