'use strict';

/* ── Starfield ── */
(function initStarfield() {
  const canvas = document.getElementById('starfield');
  const ctx = canvas.getContext('2d');
  let W, H, stars = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function mkStar() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.4 + .2,
      op: Math.random() * .6 + .15,
      speed: Math.random() * .25 + .05,
      twinkleSpeed: Math.random() * .015 + .005,
      twinkleDir: Math.random() > .5 ? 1 : -1,
    };
  }

  function init() {
    resize();
    stars = Array.from({ length: 220 }, mkStar);
  }

  function drawShootingStar(ctx, sx, sy, len, op) {
    const grad = ctx.createLinearGradient(sx, sy, sx + len, sy + len * .3);
    grad.addColorStop(0, `rgba(255,255,255,${op})`);
    grad.addColorStop(1, 'transparent');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + len, sy + len * .3);
    ctx.stroke();
  }

  let shootX = -1, shootY = -1, shootT = 0, shootOp = 0;
  let nextShoot = 4000;

  function loop(t) {
    ctx.clearRect(0, 0, W, H);

    // Twinkle & draw stars
    for (const s of stars) {
      s.op += s.twinkleSpeed * s.twinkleDir;
      if (s.op > .8 || s.op < .08) s.twinkleDir *= -1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${s.op})`;
      ctx.fill();
      s.x -= s.speed * .15;
      if (s.x < 0) { s.x = W; s.y = Math.random() * H; }
    }

    // Shooting star
    nextShoot -= 16;
    if (nextShoot <= 0) {
      shootX = Math.random() * W * .7;
      shootY = Math.random() * H * .4;
      shootOp = .9;
      nextShoot = Math.random() * 5000 + 4000;
    }
    if (shootOp > 0) {
      drawShootingStar(ctx, shootX, shootY, 140, shootOp);
      shootX += 3; shootY += 1;
      shootOp -= .025;
    }

    requestAnimationFrame(loop);
  }

  init();
  window.addEventListener('resize', init);
  requestAnimationFrame(loop);
})();

/* ── 3D Card Tilt ── */
(function initTilt() {
  const cards = document.querySelectorAll('.game-card');
  const MAX_TILT = 8;

  cards.forEach(card => {
    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top  + r.height / 2;
      const dx = (e.clientX - cx) / (r.width  / 2);
      const dy = (e.clientY - cy) / (r.height / 2);
      const rx =  dy * MAX_TILT;
      const ry = -dx * MAX_TILT;
      card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-6px) scale(1.012)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });
})();

/* ── Staggered card entrance ── */
(function staggerCards() {
  const cards = document.querySelectorAll('.game-card');
  cards.forEach((card, i) => {
    card.style.animationDelay = `${i * 80}ms`;
  });
})();
