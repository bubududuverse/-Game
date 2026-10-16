/* Node smoke-test: runs the real game files against a minimal DOM shim */
const fs = require('fs');
const vm = require('vm');

const grad = { addColorStop() {} };
function makeCtx() {
  const special = {
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    measureText: () => ({ width: 10 }),
  };
  return new Proxy({}, {
    get(t, prop) {
      if (prop in special) return special[prop];
      if (prop in t) return t[prop];
      return () => {};
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}

const listeners = { window: {}, document: {} };
function makeEl(id) {
  const el = {
    id, style: {}, textContent: '', _cls: new Set(),
    listeners: {},
    classList: {
      add: (c) => el._cls.add(c),
      remove: (c) => el._cls.delete(c),
      contains: (c) => el._cls.has(c),
      toggle: (c, on) => { const v = on === undefined ? !el._cls.has(c) : !!on; v ? el._cls.add(c) : el._cls.delete(c); return v; },
    },
    addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    blur() {},
    fire(type, ev) { (el.listeners[type] || []).forEach((fn) => fn(ev || { preventDefault() {} })); },
    getBoundingClientRect: () => ({ width: 960, height: 540 }),
  };
  if (id.endsWith('Canvas')) {
    el.width = 960; el.height = 540;
    el.getContext = () => makeCtx();
  }
  return el;
}

const registry = {};
const document = {
  hidden: false,
  getElementById: (id) => (registry[id] = registry[id] || makeEl(id)),
  addEventListener: (t, fn) => { (listeners.document[t] = listeners.document[t] || []).push(fn); },
};

let now = 0;
let rafQ = [];

class Img {
  set src(v) { setTimeout(() => this.onload && this.onload(), 0); }
}

const sandbox = {
  document,
  performance: { now: () => now },
  requestAnimationFrame: (cb) => { rafQ.push(cb); return rafQ.length; },
  cancelAnimationFrame: () => {},
  localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = v; } },
  Image: Img,
  setTimeout, setInterval, clearTimeout, clearInterval,
  console, Math, Object, Promise,
};
sandbox.window = sandbox;               // in a browser, window IS the global
sandbox.addEventListener = (t, fn) => { (listeners.window[t] = listeners.window[t] || []).push(fn); };
sandbox.localStorage = sandbox.localStorage;
vm.createContext(sandbox);

const dir = 'bubu-adventure/js/';
for (const f of ['game.js', 'engine.js', 'sprites.js']) {
  vm.runInContext(fs.readFileSync(dir + f, 'utf8'), sandbox, { filename: f });
}

const pump = (ms, step = 16.7) => {
  const end = now + ms;
  while (now < end) {
    now += step;
    const q = rafQ; rafQ = [];
    q.forEach((cb) => cb(now));
  }
};
const key = (code, type = 'keydown') =>
  (listeners.window[type] || []).forEach((fn) => fn({ code, repeat: false, preventDefault() {} }));
const click = (id) => registry[id].fire('click');

(async () => {
  await new Promise((r) => setTimeout(r, 20));            // let Images "load"
  (listeners.window.DOMContentLoaded || []).forEach((fn) => fn());
  await new Promise((r) => setTimeout(r, 700));            // loading screen delay
  pump(500);
  console.log('menu up, loading hidden =', registry.loadingScreen._cls.has('hidden'));

  click('startBtn'); pump(2000);                           // GET READY
  console.log('after ready: score =', registry.score.textContent);

  // run 20s with jumpy input
  for (let i = 0; i < 40; i++) {
    key('Space'); pump(250);
    key(i % 3 === 0 ? 'ArrowLeft' : 'ArrowRight'); pump(120);
    key('ArrowRight', 'keyup'); key('ArrowLeft', 'keyup');
    pump(130);
  }
  console.log('mid-game  score =', registry.score.textContent, ' lives =', registry.lives.textContent);

  // stand still until Dudu hits us 3x -> game over
  pump(40000);
  console.log('idle 40s  score =', registry.score.textContent, ' lives =', registry.lives.textContent,
    ' gameOver visible =', registry.gameOverScreen._cls.has('active'),
    ' final =', registry.finalScore.textContent, ' high =', registry.highScore.textContent);

  if (registry.gameOverScreen._cls.has('active')) {
    click('playAgainBtn'); pump(3000);
    console.log('restarted: score =', registry.score.textContent, ' lives =', registry.lives.textContent);
  }

  // pause / resume / quit
  key('KeyP'); pump(200);
  console.log('paused =', registry.pauseScreen._cls.has('active'));
  key('KeyP'); pump(200);
  console.log('resumed =', registry.pauseScreen._cls.has('active') === false);
  click('pauseBtn'); pump(100); click('quitBtn'); pump(300);
  console.log('back at menu =', registry.startScreen._cls.has('active'));

  // how-to round trip
  click('howToPlayBtn'); pump(100);
  console.log('howto =', registry.howToScreen._cls.has('active'));
  click('backToStartBtn'); pump(100);

  // cheat to level complete: play & grab bamboo via teleport-ish long run with jumps
  click('startBtn'); pump(2000);
  for (let i = 0; i < 400 && !registry.levelCompleteScreen._cls.has('active'); i++) {
    key('Space'); pump(300);
  }
  console.log('level complete reached =', registry.levelCompleteScreen._cls.has('active'),
    ' level =', registry.level.textContent, ' levelScore =', registry.levelScore.textContent);
  if (registry.levelCompleteScreen._cls.has('active')) {
    click('nextLevelBtn'); pump(1500);
    console.log('level 2 running, hud level =', registry.level.textContent);
  }
  // real pause mid-play
  key('KeyP'); pump(200);
  const pausedOk = registry.pauseScreen._cls.has('active');
  key('KeyP'); pump(200);
  const resumedOk = !registry.pauseScreen._cls.has('active');
  console.log('pause mid-play =', pausedOk, '| resume =', resumedOk);

  // stand still in level 2 until Dudu finishes us -> game over
  for (let i = 0; i < 300 && !registry.gameOverScreen._cls.has('active'); i++) pump(300);
  console.log('game over =', registry.gameOverScreen._cls.has('active'),
    '| final =', registry.finalScore.textContent,
    '| high =', registry.highScore.textContent,
    '| stored =', sandbox.localStorage.getItem('bubuHighScore'));
  click('menuBtn'); pump(300);
  console.log('menu after gameover =', registry.startScreen._cls.has('active'));
  console.log('SMOKE TEST DONE — no exceptions');
  process.exit(0);
})().catch((e) => { console.error('SMOKE FAIL:', e); process.exit(1); });
