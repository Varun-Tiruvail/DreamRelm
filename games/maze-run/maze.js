'use strict';
/* ================================================================
   Maze.Run – Full Game Engine  |  DreamRealm Games
   ================================================================ */

// ── Constants ──────────────────────────────────────────────────
const KEY_PHASE  = 21;   // Level at which key/lock mechanic starts
const FOG_PHASE  = 31;   // Level at which Fog of War starts
const MAP_PHASE  = 15;   // Level at which mini-map appears
const MOVE_MS    = 130;  // ms per ball move animation
const BUILD_SPD  = 5;    // cells carved per animation frame
const PART_COUNT = 7;    // particles spawned per move
const PART_LIFE  = 500;  // particle lifetime ms
const FOG_R      = 3.6;  // fog visibility radius (cells)

function gridSize(lvl) {
  return {
    cols: Math.min(6 + Math.floor(lvl * 0.85), 38),
    rows: Math.min(5 + Math.floor(lvl * 0.65), 28),
  };
}
function numKeys(lvl) {
  if (lvl < KEY_PHASE) return 0;
  return Math.min(2 + Math.floor((lvl - KEY_PHASE) / 5), 5);
}
function calcScore(lvl, elapsedMs, keys) {
  const base = lvl * 600;
  const pen  = Math.min(Math.floor(elapsedMs / 80), Math.floor(base * 0.85));
  return Math.max(base - pen + keys * 250, 50);
}

// ── State ──────────────────────────────────────────────────────
const S = {
  level: 1, phase: 'idle',
  cols: 0, rows: 0, cellSize: 0,
  cells: null,
  offsetX: 0, offsetY: 0,

  // Build animation
  buildQueue: [], buildIndex: 0,

  // Ball
  ball: { col:0, row:0, x:0, y:0, fx:0, fy:0, tx:0, ty:0, anim:false, animStart:0, trail:[] },
  goal: { col:0, row:0 },

  // Keys & Locks
  keys: [], locks: [],

  // Timer
  startTime: 0, elapsed: 0, timerID: null,

  // Score
  score: 0, bestScore: 0,
  sessionBest: {},   // level → { time, score, path }
  bestPath: null,    // ghost path for current level

  // Ghost
  currentPath: [],   // { col, row, t } during this run
  ghostRunStart: 0,

  // Particles
  particles: [],

  // Flags
  inputEnabled: false,
  fogEnabled: false,
  mapVisible: false,
};

// ── DOM ────────────────────────────────────────────────────────
let canvas, ctx, miniCanvas, miniCtx;

function $(id) { return document.getElementById(id); }

// ── Boot ───────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  canvas     = $('maze-canvas');
  ctx        = canvas.getContext('2d');
  miniCanvas = $('mini-map');
  miniCtx    = miniCanvas ? miniCanvas.getContext('2d') : null;

  loadScores();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Keyboard
  document.addEventListener('keydown', onKey);

  // D-Pad buttons
  ['up','down','left','right'].forEach(dir => {
    const btn = $(`dpad-${dir}`);
    if (!btn) return;
    const fire = () => tryMove(dirMap[dir]);
    btn.addEventListener('touchstart', e => { e.preventDefault(); btn.classList.add('pressed'); fire(); }, { passive:false });
    btn.addEventListener('touchend',   e => { e.preventDefault(); btn.classList.remove('pressed'); }, { passive:false });
    btn.addEventListener('mousedown',  () => { btn.classList.add('pressed'); fire(); });
    btn.addEventListener('mouseup',    () => btn.classList.remove('pressed'));
  });

  // Swipe (mobile canvas)
  setupSwipe();

  // Overlay buttons
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-resume').addEventListener('click', togglePause);
  $('btn-restart').addEventListener('click', () => startLevel(S.level));
  $('btn-next').addEventListener('click', () => startLevel(S.level + 1));
  $('btn-replay').addEventListener('click', () => startLevel(S.level));
  $('btn-home').addEventListener('click', () => window.location.href = '../../index.html');
  $('btn-home2').addEventListener('click', () => window.location.href = '../../index.html');
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (S.phase==='playing') togglePause(); else if (S.phase==='paused') togglePause(); }});

  // Show D-Pad on touch device
  if ('ontouchstart' in window) $('dpad-container').classList.remove('hidden');

  startLevel(1);
  requestAnimationFrame(loop);
});

const dirMap = { up:{dr:-1,dc:0,wall:'N',opp:'S'}, down:{dr:1,dc:0,wall:'S',opp:'N'}, left:{dr:0,dc:-1,wall:'W',opp:'E'}, right:{dr:0,dc:1,wall:'E',opp:'W'} };

function onKey(e) {
  const map = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right', w:'up', s:'down', a:'left', d:'right', W:'up', S:'down', A:'left', D:'right' };
  if (map[e.key]) { e.preventDefault(); tryMove(dirMap[map[e.key]]); }
}

// ── Resize Canvas ──────────────────────────────────────────────
function resizeCanvas() {
  const gc  = $('game-container');
  const pad = 16;
  canvas.width  = gc.clientWidth  - pad;
  canvas.height = gc.clientHeight - pad;
  if (S.phase !== 'idle') recomputeLayout();
}

function recomputeLayout() {
  const { cols, rows } = S;
  if (!cols) return;
  S.cellSize = Math.max(10, Math.min(Math.floor(canvas.width/cols), Math.floor(canvas.height/rows), 72));
  const mw = S.cellSize * cols, mh = S.cellSize * rows;
  S.offsetX = Math.floor((canvas.width  - mw) / 2);
  S.offsetY = Math.floor((canvas.height - mh) / 2);
  // Reposition ball pixel coords
  S.ball.x = S.offsetX + S.ball.col * S.cellSize + S.cellSize/2;
  S.ball.y = S.offsetY + S.ball.row * S.cellSize + S.cellSize/2;
  S.ball.fx = S.ball.tx = S.ball.x;
  S.ball.fy = S.ball.ty = S.ball.y;
}

// ── Level Start ────────────────────────────────────────────────
function startLevel(lvl) {
  S.level = lvl;
  S.phase = 'building';
  S.particles = [];
  S.currentPath = [];
  S.elapsed = 0;
  S.inputEnabled = false;
  S.fogEnabled = lvl >= FOG_PHASE;
  S.mapVisible = lvl >= MAP_PHASE;

  hideOverlay($('win-overlay'));
  hideOverlay($('pause-overlay'));
  $('build-msg').classList.remove('hidden');
  miniCanvas && (S.mapVisible ? miniCanvas.classList.remove('hidden') : miniCanvas.classList.add('hidden'));

  const { cols, rows } = gridSize(lvl);
  S.cols = cols; S.rows = rows;

  const nk = numKeys(lvl);
  const { cells, buildQueue } = generateMaze(cols, rows);
  S.cells = cells;
  S.buildQueue = buildQueue;
  S.buildIndex = 0;

  S.goal = { col: cols-1, row: rows-1 };

  if (nk > 0) {
    const kl = placeKeysAndLocks(cells, rows, cols, nk);
    S.keys  = kl.keys;
    S.locks = kl.locks;
    $('hud-keys-block').classList.remove('hidden');
  } else {
    S.keys = []; S.locks = [];
    $('hud-keys-block').classList.add('hidden');
  }

  // Ball start
  S.ball.col = 0; S.ball.row = 0;
  recomputeLayout();
  S.bestPath = S.sessionBest[lvl]?.path || null;

  updateHUD();
  flashLevel();
}

function flashLevel() {
  const el = document.createElement('div');
  el.className = 'level-flash';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 500);
}

// ── Maze Generation: Recursive Backtracker DFS ─────────────────
function generateMaze(cols, rows) {
  const cells = [];
  for (let r = 0; r < rows; r++) {
    cells[r] = [];
    for (let c = 0; c < cols; c++) {
      cells[r][c] = { walls:{N:true,S:true,E:true,W:true}, visited:false, hasKey:false, keyId:-1 };
    }
  }
  const buildQueue = [];
  const stack = [{ r:0, c:0 }];
  cells[0][0].visited = true;
  const DIRS = [{dr:-1,dc:0,w:'N',o:'S'},{dr:1,dc:0,w:'S',o:'N'},{dr:0,dc:-1,w:'W',o:'E'},{dr:0,dc:1,w:'E',o:'W'}];

  while (stack.length) {
    const cur = stack[stack.length - 1];
    const avail = DIRS.filter(d => {
      const nr = cur.r+d.dr, nc = cur.c+d.dc;
      return nr>=0 && nr<rows && nc>=0 && nc<cols && !cells[nr][nc].visited;
    });
    if (avail.length) {
      const d = avail[Math.floor(Math.random()*avail.length)];
      const nr = cur.r+d.dr, nc = cur.c+d.dc;
      cells[cur.r][cur.c].walls[d.w] = false;
      cells[nr][nc].walls[d.o] = false;
      cells[nr][nc].visited = true;
      buildQueue.push({ r:nr, c:nc, fr:cur.r, fc:cur.c });
      stack.push({ r:nr, c:nc });
    } else {
      stack.pop();
    }
  }

  // Mark dead ends
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
    const cell = cells[r][c];
    cell.deadEnd = (['N','S','E','W'].filter(w=>!cell.walls[w]).length === 1);
  }
  return { cells, buildQueue };
}

// ── BFS path from (sr,sc) to (er,ec) ──────────────────────────
function bfsPath(cells, rows, cols, sr, sc, er, ec, lockedLocks) {
  const dist = Array.from({length:rows}, ()=>new Array(cols).fill(-1));
  const prev = Array.from({length:rows}, ()=>new Array(cols).fill(null));
  dist[sr][sc] = 0;
  const q = [{r:sr,c:sc}];
  const DIRS = [{dr:-1,dc:0,w:'N'},{dr:1,dc:0,w:'S'},{dr:0,dc:-1,w:'W'},{dr:0,dc:1,w:'E'}];
  while (q.length) {
    const cur = q.shift();
    if (cur.r===er && cur.c===ec) break;
    for (const d of DIRS) {
      const nr=cur.r+d.dr, nc=cur.c+d.dc;
      if (nr<0||nr>=rows||nc<0||nc>=cols) continue;
      if (cells[cur.r][cur.c].walls[d.w]) continue;
      // Check if blocked by a lock
      if (lockedLocks) {
        const blocked = lockedLocks.some(lk => !lk.unlocked &&
          ((lk.fr===cur.r&&lk.fc===cur.c&&lk.tr===nr&&lk.tc===nc)||
           (lk.fr===nr&&lk.fc===nc&&lk.tr===cur.r&&lk.tc===cur.c)));
        if (blocked) continue;
      }
      if (dist[nr][nc]===-1) {
        dist[nr][nc] = dist[cur.r][cur.c]+1;
        prev[nr][nc] = cur;
        q.push({r:nr,c:nc});
      }
    }
  }
  if (dist[er][ec]===-1) return null;
  const path = [];
  let cur = {r:er,c:ec};
  while (cur) { path.unshift(cur); cur = prev[cur.r][cur.c]; }
  return path;
}

// ── Keys & Locks Placement ─────────────────────────────────────
function placeKeysAndLocks(cells, rows, cols, nk) {
  const sol = bfsPath(cells, rows, cols, 0, 0, cols-1, rows-1, null);
  if (!sol || sol.length < nk+2) return { keys:[], locks:[] };

  const locks = [];
  for (let i=1; i<=nk; i++) {
    const idx = Math.floor((i/(nk+1)) * sol.length);
    if (idx<=0 || idx>=sol.length) continue;
    const prev = sol[idx-1], next = sol[idx];
    let dir;
    if (next.r<prev.r) dir='N'; else if (next.r>prev.r) dir='S';
    else if (next.c<prev.c) dir='W'; else dir='E';
    locks.push({ fr:prev.r,fc:prev.c,tr:next.r,tc:next.c, dir, keyId:i-1, unlocked:false });
  }
  if (!locks.length) return { keys:[], locks:[] };

  // Assign zones: zone 0 = reachable from start without passing any lock
  const zoneMask = Array.from({length:rows},()=>new Array(cols).fill(-1));
  for (let z=0; z<locks.length+1; z++) {
    const activeLocks = locks.filter(lk=>!lk.unlocked).slice(z); // locks from zone z onward are still blocked
    const reachable = floodFill(cells, rows, cols, 0, 0, locks.slice(z));
    for (const {r,c} of reachable) if (zoneMask[r][c]===-1) zoneMask[r][c]=z;
  }

  // Place one key per zone in a dead-end cell within that zone, not start/end
  const keys = [];
  for (let z=0; z<locks.length; z++) {
    const deadEnds = [];
    for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
      if (zoneMask[r][c]===z && cells[r][c].deadEnd && !(r===0&&c===0) && !(r===rows-1&&c===cols-1)) {
        deadEnds.push({r,c});
      }
    }
    if (!deadEnds.length) {
      // Fallback: any cell in zone
      for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
        if (zoneMask[r][c]===z && !(r===0&&c===0) && !(r===rows-1&&c===cols-1)) deadEnds.push({r,c});
      }
    }
    if (deadEnds.length) {
      const pick = deadEnds[Math.floor(Math.random()*deadEnds.length)];
      cells[pick.r][pick.c].hasKey = true;
      cells[pick.r][pick.c].keyId  = z;
      keys.push({ r:pick.r, c:pick.c, keyId:z, collected:false });
    }
  }
  return { keys, locks };
}

function floodFill(cells, rows, cols, sr, sc, blockedLocks) {
  const visited = Array.from({length:rows},()=>new Array(cols).fill(false));
  const DIRS = [{dr:-1,dc:0,w:'N'},{dr:1,dc:0,w:'S'},{dr:0,dc:-1,w:'W'},{dr:0,dc:1,w:'E'}];
  const q = [{r:sr,c:sc}];
  visited[sr][sc] = true;
  const result = [{r:sr,c:sc}];
  while (q.length) {
    const cur = q.shift();
    for (const d of DIRS) {
      const nr=cur.r+d.dr, nc=cur.c+d.dc;
      if (nr<0||nr>=rows||nc<0||nc>=cols||visited[nr][nc]) continue;
      if (cells[cur.r][cur.c].walls[d.w]) continue;
      const blocked = blockedLocks && blockedLocks.some(lk =>
        (lk.fr===cur.r&&lk.fc===cur.c&&lk.tr===nr&&lk.tc===nc)||
        (lk.fr===nr&&lk.fc===nc&&lk.tr===cur.r&&lk.tc===cur.c));
      if (blocked) continue;
      visited[nr][nc] = true;
      q.push({r:nr,c:nc});
      result.push({r:nr,c:nc});
    }
  }
  return result;
}

// ── Input: Move ────────────────────────────────────────────────
function tryMove(d) {
  if (S.phase !== 'playing' || !S.inputEnabled || S.ball.anim) return;
  const { col, row } = S.ball;
  if (S.cells[row][col].walls[d.wall]) return; // wall in this direction

  const nr = row + d.dr, nc = col + d.dc;
  if (nr<0||nr>=S.rows||nc<0||nc>=S.cols) return;

  // Check for locked door
  const blocked = S.locks.some(lk => !lk.unlocked &&
    ((lk.fr===row&&lk.fc===col&&lk.tr===nr&&lk.tc===nc)||
     (lk.fr===nr&&lk.fc===nc&&lk.tr===row&&lk.tc===col)));
  if (blocked) { shakeLock(row,col,nr,nc); return; }

  // Start move animation
  animateMove(nc, nr);
}

let lockShakeTimer = null;
function shakeLock(fr,fc,tr,tc) {
  // visual: flash the lock red briefly (handled in draw)
  S.locks.forEach(lk => {
    if ((lk.fr===fr&&lk.fc===fc&&lk.tr===tr&&lk.tc===tc) ||
        (lk.fr===tr&&lk.fc===tc&&lk.tr===fr&&lk.tc===fc)) lk.shake = 6;
  });
}

function animateMove(nc, nr) {
  const ball = S.ball;
  ball.anim      = true;
  ball.animStart = performance.now();
  ball.fx = ball.x; ball.fy = ball.y;
  ball.tx = S.offsetX + nc * S.cellSize + S.cellSize/2;
  ball.ty = S.offsetY + nr * S.cellSize + S.cellSize/2;

  // Trail
  ball.trail.push({x:ball.x, y:ball.y});
  if (ball.trail.length > 8) ball.trail.shift();

  // Particles burst backward
  const angle = Math.atan2(ball.fy - ball.ty, ball.fx - ball.tx);
  for (let i=0; i<PART_COUNT; i++) {
    const a = angle + (Math.random()-.5)*1.2;
    const spd = Math.random()*2 + 1;
    S.particles.push({ x:ball.x, y:ball.y, vx:Math.cos(a)*spd, vy:Math.sin(a)*spd, life:PART_LIFE, maxLife:PART_LIFE, r:Math.random()*3+1 });
  }

  ball.col = nc; ball.row = nr;

  // Record path for ghost replay
  S.currentPath.push({ col:nc, row:nr, t: performance.now() - S.ghostRunStart });
}

// ── Timer ──────────────────────────────────────────────────────
function startTimer() {
  S.startTime = performance.now();
  S.ghostRunStart = S.startTime;
  clearInterval(S.timerID);
  S.timerID = setInterval(() => {
    if (S.phase !== 'playing') return;
    S.elapsed = performance.now() - S.startTime;
    updateHUD();
  }, 250);
}

function stopTimer() { clearInterval(S.timerID); }

// ── HUD ────────────────────────────────────────────────────────
function updateHUD() {
  $('hud-level').textContent = S.level;
  const ms = S.elapsed;
  const m  = Math.floor(ms/60000);
  const s  = Math.floor((ms%60000)/1000);
  $('hud-time').textContent = `${m}:${s.toString().padStart(2,'0')}`;
  $('hud-score').textContent = S.score;

  const collected = S.keys.filter(k=>k.collected).length;
  if (S.keys.length) {
    $('hud-keys').textContent = `${collected}/${S.keys.length}`;
    $('hud-keys-block').classList.remove('hidden');
  }
}

// ── Overlay helpers ────────────────────────────────────────────
function showOverlay(el) { el.classList.remove('hidden'); }
function hideOverlay(el) { el.classList.add('hidden'); }

function togglePause() {
  if (S.phase==='playing') {
    S.phase = 'paused';
    showOverlay($('pause-overlay'));
  } else if (S.phase==='paused') {
    S.phase = 'playing';
    hideOverlay($('pause-overlay'));
    S.startTime = performance.now() - S.elapsed;
  }
}

// ── Win ────────────────────────────────────────────────────────
function triggerWin() {
  S.phase = 'won';
  stopTimer();
  S.inputEnabled = false;

  const score = calcScore(S.level, S.elapsed, S.keys.filter(k=>k.collected).length);
  S.score = score;

  const prev = S.sessionBest[S.level];
  const isNewBest = !prev || S.elapsed < prev.time;
  if (isNewBest) {
    S.sessionBest[S.level] = { time: S.elapsed, score, path: [...S.currentPath] };
    saveScores();
  }

  // Populate win overlay
  const m = Math.floor(S.elapsed/60000);
  const sec = Math.floor((S.elapsed%60000)/1000);
  $('ws-time').textContent  = `${m}:${sec.toString().padStart(2,'0')}`;
  $('ws-score').textContent = score.toLocaleString();

  const best = S.sessionBest[S.level];
  const bm = Math.floor(best.time/60000);
  const bs = Math.floor((best.time%60000)/1000);
  $('ws-best').textContent = `${bm}:${bs.toString().padStart(2,'0')}`;

  setTimeout(() => showOverlay($('win-overlay')), 600);
  spawnWinParticles();
}

function spawnWinParticles() {
  for (let i=0; i<80; i++) {
    setTimeout(() => {
      const cx = canvas.width/2 + S.offsetX;
      const cy = canvas.height/2 + S.offsetY;
      const a = Math.random()*Math.PI*2;
      const spd = Math.random()*6+2;
      const colors = ['#a855f7','#06b6d4','#10b981','#fbbf24','#ec4899'];
      S.particles.push({
        x: S.offsetX + (S.cols-1)*S.cellSize + S.cellSize/2,
        y: S.offsetY + (S.rows-1)*S.cellSize + S.cellSize/2,
        vx: Math.cos(a)*spd, vy: Math.sin(a)*spd - 2,
        life:1200, maxLife:1200, r:Math.random()*4+2,
        color: colors[Math.floor(Math.random()*colors.length)],
      });
    }, i*15);
  }
}

// ── Persistence ────────────────────────────────────────────────
function saveScores() {
  try {
    const data = {};
    for (const [lvl, val] of Object.entries(S.sessionBest)) {
      data[lvl] = { time: val.time, score: val.score };
    }
    localStorage.setItem('maze_run_scores', JSON.stringify(data));
  } catch {}
}

function loadScores() {
  try {
    const raw = localStorage.getItem('maze_run_scores');
    if (raw) {
      const data = JSON.parse(raw);
      Object.assign(S.sessionBest, data);
    }
  } catch {}
}

// ── Swipe ──────────────────────────────────────────────────────
function setupSwipe() {
  let sx=0, sy=0;
  canvas.addEventListener('touchstart', e => { sx=e.touches[0].clientX; sy=e.touches[0].clientY; }, { passive:true });
  canvas.addEventListener('touchend',   e => {
    const dx = e.changedTouches[0].clientX-sx;
    const dy = e.changedTouches[0].clientY-sy;
    if (Math.max(Math.abs(dx),Math.abs(dy)) < 20) return;
    if (Math.abs(dx)>Math.abs(dy)) tryMove(dx>0 ? dirMap.right : dirMap.left);
    else                           tryMove(dy>0 ? dirMap.down  : dirMap.up);
  }, { passive:true });
}

// ── Main Game Loop ─────────────────────────────────────────────
function loop(ts) {
  requestAnimationFrame(loop);

  if (S.phase==='idle') return;

  // Build animation
  if (S.phase==='building') {
    for (let i=0; i<BUILD_SPD && S.buildIndex<S.buildQueue.length; i++, S.buildIndex++) {
      // cells are already carved in generateMaze; buildQueue just drives animation timing
    }
    if (S.buildIndex >= S.buildQueue.length) {
      S.phase = 'playing';
      S.inputEnabled = true;
      $('build-msg').classList.add('hidden');
      startTimer();
    }
    drawAll(ts);
    return;
  }

  // Update ball animation
  if (S.ball.anim) {
    const t = Math.min((ts - S.ball.animStart) / MOVE_MS, 1);
    const ease = 1 - Math.pow(1-t, 3); // ease-out-cubic
    S.ball.x = S.ball.fx + (S.ball.tx - S.ball.fx) * ease;
    S.ball.y = S.ball.fy + (S.ball.ty - S.ball.fy) * ease;
    if (t >= 1) {
      S.ball.anim = false;
      S.ball.x = S.ball.tx; S.ball.y = S.ball.ty;
      checkCell();
    }
  }

  // Update particles
  const now = ts;
  S.particles = S.particles.filter(p => {
    p.life -= 16;
    p.x += p.vx; p.y += p.vy;
    p.vy += 0.08; // gravity
    p.vx *= 0.94;
    return p.life > 0;
  });

  // Shake decay
  S.locks.forEach(lk => { if (lk.shake > 0) lk.shake--; });

  drawAll(ts);
}

// ── Check Current Cell ─────────────────────────────────────────
function checkCell() {
  if (S.phase !== 'playing') return;
  const { col, row } = S.ball;

  // Pick up key?
  const key = S.keys.find(k => !k.collected && k.r===row && k.c===col);
  if (key) {
    key.collected = true;
    // Unlock corresponding lock
    S.locks.forEach(lk => { if (lk.keyId===key.keyId) lk.unlocked=true; });
    animKeyHUD();
    updateHUD();
  }

  // Win?
  if (col===S.goal.col && row===S.goal.row) {
    // Ensure all locks that should be unlocked are open (all keys collected)
    const pendingLocks = S.locks.filter(lk=>!lk.unlocked);
    if (pendingLocks.length===0) triggerWin();
  }
}

function animKeyHUD() {
  const el = $('hud-keys-block');
  el.classList.remove('key-pop');
  void el.offsetWidth; // reflow
  el.classList.add('key-pop');
}

// ── Drawing ────────────────────────────────────────────────────
function drawAll(ts) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();

  const progress = S.buildIndex / Math.max(S.buildQueue.length, 1);

  if (S.cells) {
    if (S.phase === 'building') drawBuildPhase(progress);
    else                        drawPlayPhase(ts);
  }
}

function drawBackground() {
  ctx.fillStyle = '#050510';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Subtle grid pattern
  ctx.strokeStyle = 'rgba(124,58,237,0.05)';
  ctx.lineWidth = 0.5;
  const step = 40;
  for (let x=0; x<canvas.width; x+=step) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
  for (let y=0; y<canvas.height; y+=step) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
}

// Build phase: animate maze carving from solid block
function drawBuildPhase(progress) {
  const { cols, rows, cellSize: cs, offsetX: ox, offsetY: oy, cells, buildQueue, buildIndex } = S;

  // Draw all cells as walls first
  for (let r=0; r<rows; r++) {
    for (let c=0; c<cols; c++) {
      const px = ox + c*cs, py = oy + r*cs;
      ctx.fillStyle = '#0d0d22';
      ctx.fillRect(px+1, py+1, cs-2, cs-2);
    }
  }

  // Draw carved cells up to buildIndex
  const carvedSet = new Set();
  carvedSet.add('0,0');
  for (let i=0; i<buildIndex && i<buildQueue.length; i++) {
    const { r, c } = buildQueue[i];
    carvedSet.add(`${r},${c}`);
  }

  for (let r=0; r<rows; r++) {
    for (let c=0; c<cols; c++) {
      if (!carvedSet.has(`${r},${c}`)) {
        // Solid wall cell
        ctx.fillStyle = '#12122e';
        ctx.fillRect(ox+c*cs, oy+r*cs, cs, cs);
        continue;
      }
      const px = ox + c*cs, py = oy + r*cs;
      ctx.fillStyle = '#0a0a1e';
      ctx.fillRect(px, py, cs, cs);
      drawCellWalls(r, c, px, py, cs);
    }
  }

  // Glowing frontier cell
  if (buildIndex < buildQueue.length) {
    const { r, c } = buildQueue[Math.min(buildIndex, buildQueue.length-1)];
    const px = ox+c*cs, py = oy+r*cs;
    ctx.shadowColor = '#a855f7';
    ctx.shadowBlur  = 12;
    ctx.fillStyle = 'rgba(168,85,247,0.3)';
    ctx.fillRect(px+2, py+2, cs-4, cs-4);
    ctx.shadowBlur = 0;
  }

  drawBorder();
}

function drawPlayPhase(ts) {
  const { cols, rows, cellSize: cs, offsetX: ox, offsetY: oy, cells } = S;

  // Zone tints for key areas
  const ZONE_COLORS = ['rgba(168,85,247,0.07)','rgba(236,72,153,0.07)','rgba(245,158,11,0.07)','rgba(16,185,129,0.07)','rgba(14,165,233,0.07)'];

  // Draw cells - open path is visibly lighter
  for (let r=0; r<rows; r++) {
    for (let c=0; c<cols; c++) {
      const px = ox+c*cs, py = oy+r*cs;
      ctx.fillStyle = '#0c0c20';
      ctx.fillRect(px, py, cs, cs);
    }
  }

  // Draw goal
  drawGoal(ts);

  // Draw keys
  drawKeys(ts);

  // Draw locks
  drawLocks(ts);

  // Draw ghost path
  drawGhost(ts);

  // Draw walls
  for (let r=0; r<rows; r++) {
    for (let c=0; c<cols; c++) {
      drawCellWalls(r, c, ox+c*cs, oy+r*cs, cs);
    }
  }

  // Draw particles (under ball)
  drawParticles();

  // Draw ball
  drawBall(ts);

  // Fog of war
  if (S.fogEnabled) drawFog();

  // Mini-map
  if (S.mapVisible) drawMiniMap();

  drawBorder();
}

function drawCellWalls(r, c, px, py, cs) {
  const cell = S.cells[r][c];
  const WALL_W = Math.max(2, cs * 0.1);
  ctx.strokeStyle = '#2e2e6a';  // much brighter walls
  ctx.lineWidth = WALL_W;
  ctx.lineCap = 'square';
  if (cell.walls.N) { ctx.beginPath(); ctx.moveTo(px,    py);    ctx.lineTo(px+cs, py);    ctx.stroke(); }
  if (cell.walls.S) { ctx.beginPath(); ctx.moveTo(px,    py+cs); ctx.lineTo(px+cs, py+cs); ctx.stroke(); }
  if (cell.walls.W) { ctx.beginPath(); ctx.moveTo(px,    py);    ctx.lineTo(px,    py+cs); ctx.stroke(); }
  if (cell.walls.E) { ctx.beginPath(); ctx.moveTo(px+cs, py);    ctx.lineTo(px+cs, py+cs); ctx.stroke(); }
}

function drawBorder() {
  const { cols, rows, cellSize:cs, offsetX:ox, offsetY:oy } = S;
  const w = cols*cs, h = rows*cs;
  ctx.strokeStyle = 'rgba(124,58,237,0.35)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ox, oy, w, h);
  ctx.shadowColor = '#7c3aed';
  ctx.shadowBlur  = 14;
  ctx.strokeRect(ox, oy, w, h);
  ctx.shadowBlur  = 0;
}

function drawGoal(ts) {
  const { cellSize:cs, offsetX:ox, offsetY:oy, goal } = S;
  const px = ox + goal.col*cs, py = oy + goal.row*cs;
  const cx2 = px+cs/2, cy2 = py+cs/2;
  const pulse = 0.6 + 0.4*Math.sin(ts/400);
  // Glow
  const grad = ctx.createRadialGradient(cx2,cy2,0, cx2,cy2,cs*0.7);
  grad.addColorStop(0, `rgba(16,185,129,${0.4*pulse})`);
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(px, py, cs, cs);
  // Portal ring
  ctx.strokeStyle = `rgba(52,211,153,${pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx2, cy2, cs*0.32, 0, Math.PI*2);
  ctx.stroke();
  // Inner dot
  ctx.fillStyle = `rgba(52,211,153,${pulse})`;
  ctx.shadowColor = '#10b981'; ctx.shadowBlur = 16*pulse;
  ctx.beginPath(); ctx.arc(cx2, cy2, cs*0.14, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;
  // Label
  if (cs >= 20) {
    ctx.fillStyle = 'rgba(52,211,153,0.6)';
    ctx.font = `bold ${Math.max(8,cs*0.25)}px Orbitron, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('END', cx2, py+cs-2);
  }
}

function drawKeys(ts) {
  const { cellSize:cs, offsetX:ox, offsetY:oy } = S;
  const pulse = 0.5+0.5*Math.sin(ts/300);
  for (const k of S.keys) {
    if (k.collected) continue;
    const px = ox+k.c*cs, py = oy+k.r*cs;
    const cx2 = px+cs/2, cy2 = py+cs/2;
    // Glow bg
    const grad = ctx.createRadialGradient(cx2,cy2,0,cx2,cy2,cs*0.6);
    grad.addColorStop(0, `rgba(251,191,36,${0.35*pulse})`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad; ctx.fillRect(px,py,cs,cs);
    // Key icon (simple: circle + line)
    ctx.strokeStyle = `rgba(251,191,36,${0.7+0.3*pulse})`;
    ctx.fillStyle   = `rgba(251,191,36,${0.7+0.3*pulse})`;
    ctx.lineWidth = Math.max(1.5, cs*0.06);
    ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = 10*pulse;
    // Ring
    ctx.beginPath(); ctx.arc(cx2-cs*0.08, cy2-cs*0.06, cs*0.18, 0, Math.PI*2); ctx.stroke();
    // Shaft
    ctx.beginPath(); ctx.moveTo(cx2+cs*0.04, cy2-cs*0.06+cs*0.18); ctx.lineTo(cx2+cs*0.04, cy2+cs*0.28); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx2+cs*0.04, cy2+cs*0.2); ctx.lineTo(cx2+cs*0.13, cy2+cs*0.2); ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

function drawLocks(ts) {
  const { cellSize:cs, offsetX:ox, offsetY:oy } = S;
  for (const lk of S.locks) {
    if (lk.unlocked) continue;
    const shake = lk.shake > 0 ? (Math.random()-0.5)*4 : 0;
    // Draw a barrier across the door
    let x1,y1,x2,y2;
    const fr = lk.fr, fc = lk.fc, tr = lk.tr, tc = lk.tc;
    if (lk.dir==='S'||lk.dir==='N') {
      const midRow = (Math.max(fr,tr)) * cs + oy;
      x1 = ox + Math.min(fc,tc)*cs; y1 = midRow;
      x2 = x1+cs;                   y2 = midRow;
    } else {
      const midCol = (Math.max(fc,tc)) * cs + ox;
      x1 = midCol; y1 = oy + Math.min(fr,tr)*cs;
      x2 = midCol; y2 = y1+cs;
    }
    const pulse = 0.5+0.5*Math.sin(ts/250);
    ctx.save();
    ctx.translate(shake, shake);
    ctx.strokeStyle = `rgba(239,68,68,${0.7+0.3*pulse})`;
    ctx.lineWidth = Math.max(3, cs*0.12);
    ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 12*pulse;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

function drawGhost(ts) {
  // Only draw if we have a completed best path from a previous run
  if (!S.bestPath || !S.bestPath.length) return;
  const { cellSize:cs, offsetX:ox, offsetY:oy } = S;
  const elapsed = ts - S.startTime;

  // Draw faint trail of ghost's visited path so far
  for (let i=0; i<S.bestPath.length; i++) {
    const p = S.bestPath[i];
    if (p.t > elapsed + 1500) break;
    const px = ox + p.col*cs + cs/2;
    const py = oy + p.row*cs + cs/2;
    ctx.fillStyle = 'rgba(99,102,241,0.18)';
    ctx.beginPath(); ctx.arc(px, py, cs*0.18, 0, Math.PI*2); ctx.fill();
  }

  // Current ghost position interpolated
  const gi = S.bestPath.findIndex(p => p.t >= elapsed);
  if (gi > 0) {
    const gp = S.bestPath[gi-1];
    const gpx = ox+gp.col*cs+cs/2;
    const gpy = oy+gp.row*cs+cs/2;
    ctx.fillStyle = 'rgba(99,102,241,0.5)';
    ctx.shadowColor = '#6366f1'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(gpx, gpy, cs*0.26, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawParticles() {
  for (const p of S.particles) {
    const alpha = (p.life/p.maxLife);
    ctx.fillStyle = p.color || `rgba(168,85,247,${alpha})`;
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawBall(ts) {
  const { x, y } = S.ball;
  const cs = S.cellSize;
  const r  = cs * 0.32;
  const pulse = 0.85 + 0.15*Math.sin(ts/180);

  // Outer glow
  const g = ctx.createRadialGradient(x,y,0, x,y,r*2.5);
  g.addColorStop(0, 'rgba(168,85,247,0.35)');
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x,y,r*2.5,0,Math.PI*2); ctx.fill();

  // Shadow
  ctx.shadowColor = '#a855f7'; ctx.shadowBlur = 20*pulse;

  // Ball body
  const ball = ctx.createRadialGradient(x-r*.3, y-r*.3, 0, x, y, r);
  ball.addColorStop(0, '#d8b4fe');
  ball.addColorStop(0.6, '#a855f7');
  ball.addColorStop(1, '#5b21b6');
  ctx.fillStyle = ball;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
  ctx.shadowBlur = 0;

  // Specular
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.arc(x-r*.28, y-r*.28, r*.22, 0, Math.PI*2); ctx.fill();
}

function drawFog() {
  const { ball, cellSize:cs, offsetX:ox, offsetY:oy, cols, rows } = S;
  const cx = ball.x, cy = ball.y;
  const visR = FOG_R * cs;

  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, cols*cs, rows*cs);
  ctx.clip();

  const g = ctx.createRadialGradient(cx,cy,visR*.6,cx,cy,visR*1.2);
  g.addColorStop(0, 'rgba(2,2,13,0)');
  g.addColorStop(0.7, 'rgba(2,2,13,0.7)');
  g.addColorStop(1, 'rgba(2,2,13,0.97)');

  ctx.fillStyle = g;
  ctx.compositeOperation = 'source-over';
  ctx.fillRect(ox-10, oy-10, cols*cs+20, rows*cs+20);
  ctx.restore();
}

function drawMiniMap() {
  if (!miniCtx) return;
  const { cols, rows, cells, ball, goal, offsetX, offsetY } = S;
  const mw = miniCanvas.width, mh = miniCanvas.height;
  const cw = mw/cols, ch = mh/rows;

  miniCtx.clearRect(0,0,mw,mh);
  miniCtx.fillStyle = '#02020d';
  miniCtx.fillRect(0,0,mw,mh);

  // Cells
  for (let r=0;r<rows;r++) for (let c=0;c<cols;c++) {
    miniCtx.fillStyle = '#0d0d2a';
    miniCtx.fillRect(c*cw,r*ch,cw,ch);
    // Walls
    const cell = cells[r][c];
    miniCtx.strokeStyle = '#2a2a4e';
    miniCtx.lineWidth = .5;
    if (cell.walls.N) { miniCtx.beginPath(); miniCtx.moveTo(c*cw,r*ch); miniCtx.lineTo((c+1)*cw,r*ch); miniCtx.stroke(); }
    if (cell.walls.S) { miniCtx.beginPath(); miniCtx.moveTo(c*cw,(r+1)*ch); miniCtx.lineTo((c+1)*cw,(r+1)*ch); miniCtx.stroke(); }
    if (cell.walls.W) { miniCtx.beginPath(); miniCtx.moveTo(c*cw,r*ch); miniCtx.moveTo(c*cw,(r+1)*ch); miniCtx.stroke(); }
    if (cell.walls.E) { miniCtx.beginPath(); miniCtx.moveTo((c+1)*cw,r*ch); miniCtx.lineTo((c+1)*cw,(r+1)*ch); miniCtx.stroke(); }
  }

  // Goal
  miniCtx.fillStyle = '#10b981';
  miniCtx.fillRect(goal.col*cw+1, goal.row*ch+1, cw-2, ch-2);

  // Keys
  for (const k of S.keys) {
    if (k.collected) continue;
    miniCtx.fillStyle = '#fbbf24';
    miniCtx.beginPath(); miniCtx.arc(k.c*cw+cw/2, k.r*ch+ch/2, Math.max(1,cw*.35), 0, Math.PI*2); miniCtx.fill();
  }

  // Ball
  miniCtx.fillStyle = '#a855f7';
  miniCtx.beginPath(); miniCtx.arc(ball.col*cw+cw/2, ball.row*ch+ch/2, Math.max(1.5,cw*.45), 0, Math.PI*2); miniCtx.fill();
}
