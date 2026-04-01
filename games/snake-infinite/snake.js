/**
 * Snake Infinite - Core Game Engine
 * Features: Infinite Expanding Canvas, Grid Movement, Powerups, Wormholes
 */

"use strict";

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

const SFX = {
    // Basic placeholder functions for what could be sound effects in the future
    playEat: () => console.log('eat sound'),
    playDie: () => console.log('die sound'),
    playLevelUp: () => console.log('lvl up sound')
};

// --- Game State & Configuration ---
let GAME = {
    state: 'MENU', // MENU, PLAYING, PAUSED, GAMEOVER
    score: 0,
    multiplier: 1,
    arenaLevel: 1,
    lastTime: 0,
    accumulator: 0,
    tickRate: 1000 / 15, // Game logic ticks 15 times a second
    glowIntensity: 0
};

// Base grid size - snake moves by this amount
const GRID_SIZE = 30; 

// Initial World Bounds
let WORLD = {
    minX: -GRID_SIZE * 15,
    maxX: GRID_SIZE * 15,
    minY: -GRID_SIZE * 10,
    maxY: GRID_SIZE * 10
};

// Dynamic Camera
let CAMERA = { x: 0, y: 0, zoom: 1 };
let targetCamera = { x: 0, y: 0, zoom: 1 };

// The Snake
let snake = [];
let snakeDir = { x: 1, y: 0 };
let nextDir = { x: 1, y: 0 };
let snakeSpeedBase = 15;
let currentTickRate = 1000 / snakeSpeedBase;

// Entities
let foods = [];
let powerups = [];
let wormholes = [];
let particles = [];

// --- Config Colors (Matches Tokens) ---
const COLORS = {
    head: '#34d399',
    body: '#10b981',
    food: '#06b6d4',
    grid: 'rgba(255, 255, 255, 0.03)',
    boundary: 'rgba(16, 185, 129, 0.3)',
    wormhole: '#ec4899',
    speed: '#eab308'
};

// --- Resize Handling ---
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- Background Starfield Logic (from Home Hub) ---
const starCanvas = document.getElementById('starfield');
const starCtx = starCanvas.getContext('2d');
let stars = [];
function initStars() {
    starCanvas.width = window.innerWidth;
    starCanvas.height = window.innerHeight;
    stars = [];
    for (let i = 0; i < 150; i++) {
        stars.push({
            x: Math.random() * starCanvas.width,
            y: Math.random() * starCanvas.height,
            z: Math.random() * 2 + 0.1, // depth for parallax
            alpha: Math.random() * 0.5 + 0.1
        });
    }
}
window.addEventListener('resize', initStars);
initStars();

function drawStarfield(dt) {
    starCtx.clearRect(0, 0, starCanvas.width, starCanvas.height);
    starCtx.fillStyle = '#ffffff';
    
    // Move stars based on camera delta if needed, for now just static slow drift
    stars.forEach(star => {
        // Slow constant drift
        star.y += star.z * 0.2 * (dt / 16);
        if (star.y > starCanvas.height) star.y = 0;

        starCtx.globalAlpha = star.alpha + Math.sin(Date.now() * 0.001 * star.z) * 0.2;
        starCtx.beginPath();
        starCtx.arc(star.x, star.y, star.z, 0, Math.PI * 2);
        starCtx.fill();
    });
    starCtx.globalAlpha = 1;
}


// --- Initialization ---

function resetGame() {
    GAME.score = 0;
    GAME.multiplier = 1;
    GAME.arenaLevel = 1;
    GAME.state = 'PLAYING';
    
    // Reset World Bounds
    WORLD.minX = -GRID_SIZE * 15;
    WORLD.maxX = GRID_SIZE * 15;
    WORLD.minY = -GRID_SIZE * 10;
    WORLD.maxY = GRID_SIZE * 10;
    targetCamera.zoom = 1;

    // Reset Snake (Start at center 0,0)
    snake = [
        { x: 0, y: 0 },
        { x: -GRID_SIZE, y: 0 },
        { x: -GRID_SIZE * 2, y: 0 }
    ];
    snakeDir = { x: 1, y: 0 };
    nextDir = { x: 1, y: 0 };
    
    currentTickRate = 1000 / snakeSpeedBase;

    foods = [];
    powerups = [];
    wormholes = [];
    particles = [];

    spawnFood(3);
    
    // Snap camera to start
    CAMERA.x = 0;
    CAMERA.y = 0;
    CAMERA.zoom = 1;

    updateHUD();
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('game-over-menu').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    
    // reset timers
    GAME.lastTime = 0;
    GAME.accumulator = 0;

    if (!GAME.loopId) {
        GAME.loopId = requestAnimationFrame(gameLoop);
    }
}

// --- Spawning Logic ---

function getRandomGridPos() {
    const cols = Math.floor((WORLD.maxX - WORLD.minX) / GRID_SIZE);
    const rows = Math.floor((WORLD.maxY - WORLD.minY) / GRID_SIZE);
    
    const x = WORLD.minX + Math.floor(Math.random() * cols) * GRID_SIZE;
    const y = WORLD.minY + Math.floor(Math.random() * rows) * GRID_SIZE;
    return { x, y };
}

function getSafeSpawnPos() {
    let pos;
    let safe = false;
    let attempts = 0;
    while (!safe && attempts < 100) {
        pos = getRandomGridPos();
        safe = true;
        // Check snake
        for (let s of snake) {
            if (s.x === pos.x && s.y === pos.y) safe = false;
        }
        // Check walls (don't spawn directly on bound edge)
        if (pos.x <= WORLD.minX || pos.x >= WORLD.maxX - GRID_SIZE ||
            pos.y <= WORLD.minY || pos.y >= WORLD.maxY - GRID_SIZE) {
            safe = false;
        }
        attempts++;
    }
    return pos;
}

function spawnFood(count = 1) {
    for (let i = 0; i < count; i++) {
        foods.push(getSafeSpawnPos());
    }
}

// --- Input Handling ---

// Input handling was unchanged, adding a small comment to signify readiness
document.addEventListener('keydown', (e) => {
    if (GAME.state !== 'PLAYING') return;
    
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        if (snakeDir.y === 0) nextDir = { x: 0, y: -1 };
    } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        if (snakeDir.y === 0) nextDir = { x: 0, y: 1 };
    } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        if (snakeDir.x === 0) nextDir = { x: -1, y: 0 };
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        if (snakeDir.x === 0) nextDir = { x: 1, y: 0 };
    }
});

// Touch controls via overlay buttons
document.querySelectorAll('.dpad-btn').forEach(btn => {
    btn.addEventListener('touchstart', (e) => {
        e.preventDefault(); // Prevent double firing
        if (GAME.state !== 'PLAYING') return;
        const dir = btn.getAttribute('data-dir');
        
        if (dir === 'up' && snakeDir.y === 0) nextDir = { x: 0, y: -1 };
        else if (dir === 'down' && snakeDir.y === 0) nextDir = { x: 0, y: 1 };
        else if (dir === 'left' && snakeDir.x === 0) nextDir = { x: -1, y: 0 };
        else if (dir === 'right' && snakeDir.x === 0) nextDir = { x: 1, y: 0 };
    });
});

// Add swipe detection
let touchStartX = 0;
let touchStartY = 0;
canvas.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, {passive: true});

canvas.addEventListener('touchend', e => {
    if (GAME.state !== 'PLAYING') return;
    let touchEndX = e.changedTouches[0].screenX;
    let touchEndY = e.changedTouches[0].screenY;
    
    let dx = touchEndX - touchStartX;
    let dy = touchEndY - touchStartY;
    
    if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal
        if (Math.abs(dx) > 30) {
            if (dx > 0 && snakeDir.x === 0) nextDir = { x: 1, y: 0 };
            else if (dx < 0 && snakeDir.x === 0) nextDir = { x: -1, y: 0 };
        }
    } else {
        // Vertical
        if (Math.abs(dy) > 30) {
            if (dy > 0 && snakeDir.y === 0) nextDir = { x: 0, y: 1 };
            else if (dy < 0 && snakeDir.y === 0) nextDir = { x: 0, y: -1 };
        }
    }
}, {passive: true});


// UI Buttons
document.getElementById('start-btn').addEventListener('click', resetGame);
document.getElementById('restart-btn').addEventListener('click', resetGame);

document.getElementById('pause-btn').addEventListener('click', () => {
    if (GAME.state === 'PLAYING') {
        GAME.state = 'PAUSED';
        document.querySelector('.icon-pause').style.display = 'none';
        document.querySelector('.icon-play').style.display = 'block';
    } else if (GAME.state === 'PAUSED') {
        GAME.state = 'PLAYING';
        document.querySelector('.icon-pause').style.display = 'block';
        document.querySelector('.icon-play').style.display = 'none';
        GAME.lastTime = performance.now();
        requestAnimationFrame(gameLoop);
    }
});

// --- Game Logic ---

function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x: x + GRID_SIZE/2,
            y: y + GRID_SIZE/2,
            vx: (Math.random() - 0.5) * 6,
            vy: (Math.random() - 0.5) * 6,
            life: 1,
            color: color,
            size: Math.random() * 4 + 2
        });
    }
}

function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx * (dt / 16);
        p.y += p.vy * (dt / 16);
        p.life -= 0.02 * (dt / 16);
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function expandArena() {
    GAME.arenaLevel++;
    
    // Increase bounds by 5 grid units on all sides
    WORLD.minX -= GRID_SIZE * 5;
    WORLD.maxX += GRID_SIZE * 5;
    WORLD.minY -= GRID_SIZE * 5;
    WORLD.maxY += GRID_SIZE * 5;
    
    // Zoom out camera smoothly based on new width
    const currentWorldW = WORLD.maxX - WORLD.minX;
    // Calculate zoom needed to fit roughly 70% of world width on screen
    const desiredZoom = (window.innerWidth * 0.7) / currentWorldW;
    // Clamp zoom so it doesn't get ridiculously tiny, but enough to see expansion
    targetCamera.zoom = Math.max(0.3, desiredZoom);
    
    // Visual effect for expansion
    GAME.glowIntensity = 1.0;
    SFX.playLevelUp();
    
    // Maintain food density relative to size
    spawnFood(2);
}

function checkExpansion() {
    // Thresholds: Every 10 score points we expand
    const thresholds = [10, 25, 50, 80, 120, 170, 230, 300];
    if (thresholds.includes(GAME.score) && GAME.arenaLevel <= thresholds.indexOf(GAME.score) + 1) {
        expandArena();
    }
}

function gameOver() {
    GAME.state = 'GAMEOVER';
    SFX.playDie();
    
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('game-over-menu').classList.remove('hidden');
    
    document.getElementById('go-score').innerText = GAME.score;
    document.getElementById('go-max-mult').innerText = `x${GAME.multiplier}`;
    document.getElementById('go-arena-lvl').innerText = GAME.arenaLevel;
}

function updateHUD() {
    document.getElementById('score-display').innerText = GAME.score;
    document.getElementById('multiplier-display').innerText = `x${GAME.multiplier}`;
    document.getElementById('arena-lvl-display').innerText = GAME.arenaLevel;
    
    // Visual pop on multiplier
    const mDisplay = document.getElementById('multiplier-display');
    mDisplay.style.transform = 'scale(1.3)';
    setTimeout(() => mDisplay.style.transform = 'scale(1)', 150);
}

function tick() {
    snakeDir = nextDir;
    
    // Calculate new head position
    const head = snake[0];
    const newHead = {
        x: head.x + snakeDir.x * GRID_SIZE,
        y: head.y + snakeDir.y * GRID_SIZE
    };

    // --- Boundary Collision ---
    if (newHead.x < WORLD.minX || newHead.x > WORLD.maxX - GRID_SIZE || 
        newHead.y < WORLD.minY || newHead.y > WORLD.maxY - GRID_SIZE) { 
        // console.error('DIED BY BOUNDARY:', newHead, WORLD);
        gameOver();
        return;
    }

    // --- Self Collision ---
    for (let i = 0; i < snake.length; i++) {
        if (newHead.x === snake[i].x && newHead.y === snake[i].y) {
            // console.error('DIED BY SELF:', newHead, snake);
            gameOver();
            return;
        }
    }

    snake.unshift(newHead); // Add new head

    // --- Food Collision ---
    let ateFood = false;
    for (let i = 0; i < foods.length; i++) {
        if (newHead.x === foods[i].x && newHead.y === foods[i].y) {
            foods.splice(i, 1);
            ateFood = true;
            break;
        }
    }

    if (ateFood) {
        GAME.score += 1 * GAME.multiplier;
        if (GAME.score % 5 === 0) GAME.multiplier = Math.min(GAME.multiplier + 1, 10);
        
        SFX.playEat();
        spawnParticles(newHead.x, newHead.y, COLORS.food, 15);
        spawnFood(1);
        updateHUD();
        checkExpansion();
    } else {
        snake.pop(); // Remove tail if we didn't eat
    }
}

// --- Rendering ---

function render(dt) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Camera follow logic (Smooth interpolation)
    targetCamera.x = snake[0].x - canvas.width / (2 * CAMERA.zoom);
    targetCamera.y = snake[0].y - canvas.height / (2 * CAMERA.zoom);
    
    CAMERA.x += (targetCamera.x - CAMERA.x) * 0.1 * (dt/16);
    CAMERA.y += (targetCamera.y - CAMERA.y) * 0.1 * (dt/16);
    CAMERA.zoom += (targetCamera.zoom - CAMERA.zoom) * 0.05 * (dt/16);

    ctx.save();
    
    // Apply Camera Transform
    // Move to center, scale, then translate back
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(CAMERA.zoom, CAMERA.zoom);
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
    
    ctx.translate(-CAMERA.x, -CAMERA.y);

    // Render Grid
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = WORLD.minX; x <= WORLD.maxX; x += GRID_SIZE) {
        ctx.moveTo(x, WORLD.minY); ctx.lineTo(x, WORLD.maxY);
    }
    for (let y = WORLD.minY; y <= WORLD.maxY; y += GRID_SIZE) {
        ctx.moveTo(WORLD.minX, y); ctx.lineTo(WORLD.maxX, y);
    }
    ctx.stroke();

    // Render Bounds Glow
    // When expanding, intense glow
    GAME.glowIntensity = Math.max(0, GAME.glowIntensity - 0.02 * (dt/16));
    const boundGlowAlpha = 0.3 + GAME.glowIntensity * 0.7;
    
    ctx.lineWidth = 4;
    ctx.strokeStyle = `rgba(16, 185, 129, ${boundGlowAlpha})`;
    ctx.shadowColor = `rgba(16, 185, 129, ${boundGlowAlpha})`;
    ctx.shadowBlur = 20 + GAME.glowIntensity * 40;
    ctx.strokeRect(WORLD.minX, WORLD.minY, WORLD.maxX - WORLD.minX, WORLD.maxY - WORLD.minY);
    ctx.shadowBlur = 0; // Reset

    // Render Food
    foods.forEach(f => {
        // Pulsate food
        const scale = 1 + Math.sin(performance.now() * 0.005) * 0.1;
        const center = { x: f.x + GRID_SIZE/2, y: f.y + GRID_SIZE/2 };
        const radius = (GRID_SIZE / 2 - 4) * scale;
        
        ctx.fillStyle = COLORS.food;
        ctx.shadowColor = COLORS.food;
        ctx.shadowBlur = 15;
        
        ctx.beginPath();
        // Star shape for food
        for (let i = 0; i < 5; i++) {
            ctx.lineTo(
                center.x + Math.cos((18 + i * 72) * Math.PI / 180) * radius,
                center.y - Math.sin((18 + i * 72) * Math.PI / 180) * radius
            );
            ctx.lineTo(
                center.x + Math.cos((54 + i * 72) * Math.PI / 180) * (radius / 2),
                center.y - Math.sin((54 + i * 72) * Math.PI / 180) * (radius / 2)
            );
        }
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
    });

    // Render Particles
    particles.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10 * p.life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    });
    ctx.globalAlpha = 1;

    // Render Snake
    for (let i = snake.length - 1; i >= 0; i--) {
        const seg = snake[i];
        
        // Gradient color from head to tail
        const ratio = 1 - (i / snake.length);
        
        ctx.fillStyle = i === 0 ? COLORS.head : COLORS.body;
        // Head glow
        if (i === 0) {
            ctx.shadowColor = COLORS.head;
            ctx.shadowBlur = 20;
        } else {
            ctx.shadowBlur = 0;
            ctx.globalAlpha = ratio * 0.5 + 0.5; // tail fades slightly
        }

        // Draw body segment (rounded rect simulation via arcs might be heavy, standard rect for perf)
        const pad = 2; // Gap between segments
        ctx.fillRect(seg.x + pad, seg.y + pad, GRID_SIZE - pad*2, GRID_SIZE - pad*2);
        
        // Eye logic for head
        if (i === 0) {
            ctx.fillStyle = '#111';
            let e1x, e1y, e2x, e2y;
            const eyeOffset1 = 6;
            const eyeOffset2 = 18;
            
            // Positioning eyes based on direction
            if (snakeDir.x === 1) { // Right
                e1x = e2x = seg.x + 22; e1y = seg.y + eyeOffset1; e2y = seg.y + eyeOffset2;
            } else if (snakeDir.x === -1) { // Left
                e1x = e2x = seg.x + 8; e1y = seg.y + eyeOffset1; e2y = seg.y + eyeOffset2;
            } else if (snakeDir.y === 1) { // Down
                e1x = seg.x + eyeOffset1; e2x = seg.x + eyeOffset2; e1y = e2y = seg.y + 22;
            } else { // Up
                e1x = seg.x + eyeOffset1; e2x = seg.x + eyeOffset2; e1y = e2y = seg.y + 8;
            }
            
            ctx.beginPath(); ctx.arc(e1x, e1y, 2, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(e2x, e2y, 2, 0, Math.PI*2); ctx.fill();
        }
        
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
    }

    ctx.restore();
}

// --- Main Loop ---

function gameLoop(timestamp) {
    if (GAME.state !== 'PLAYING') {
        GAME.loopId = null;
        return;
    }

    if (!GAME.lastTime) {
        GAME.lastTime = timestamp;
        GAME.accumulator = 0;
    }
    
    let dt = timestamp - GAME.lastTime;
    GAME.lastTime = timestamp;
    
    // Clamp the dt to prevent the "spiral of death" or huge lag spikes
    // 250ms = maximum frames skipped
    if (dt > 250) {
        dt = 250;
    }

    // Force clear accumulator if paused for a long time or restarting
    if (dt === 0) {
        GAME.accumulator = 0;
    }

    GAME.accumulator += dt;

    // Fixed timestep logic update
    while (GAME.accumulator >= currentTickRate) {
        tick();
        GAME.accumulator -= currentTickRate;
    }

    // Uncapped interpolation render (particles, camera smooth follow)
    updateParticles(dt);
    drawStarfield(dt);
    render(dt);

    GAME.loopId = requestAnimationFrame(gameLoop);
}

// Mobile controls setup
// Show mobile D-Pad only on touch devices
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    document.getElementById('mobile-controls').classList.remove('hidden');
    // We add a 'active' class to override the media query if touch capability is detected specifically
    document.getElementById('mobile-controls').classList.add('active'); 
}
