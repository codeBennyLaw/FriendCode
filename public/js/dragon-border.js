/* A flexible dragon follows the actual rounded border, including wrapped mobile cards. */
(() => {
  const PAD = 64;
  const TAU = Math.PI * 2;
  const dragons = new Map();
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let lastPaint = 0;
  let overlay = null;
  const allowed = d => d.visible && d.canvas.isConnected && (overlay ? d.modal === overlay : !d.modal);

  function borderPoint(d, distance, out = {}) {
    const r = d.radius;
    const w = d.straightWidth;
    let s = ((distance % d.perimeter) + d.perimeter) % d.perimeter;
    const lengths = d.segments;
    let part = 0;
    while (part < 7 && s > lengths[part]) s -= lengths[part++];
    let x, y, angle;
    if (part === 0) { x = r + s; y = 0; angle = 0; }
    else if (part === 2) { x = d.width; y = r + s; angle = Math.PI / 2; }
    else if (part === 4) { x = d.width - r - s; y = d.height; angle = Math.PI; }
    else if (part === 6) { x = 0; y = d.height - r - s; angle = -Math.PI / 2; }
    else {
      const corner = (part - 1) / 2;
      const a = -Math.PI / 2 + corner * Math.PI / 2 + s / r;
      const cx = corner < 2 ? d.width - r : r;
      const cy = corner === 0 || corner === 3 ? r : d.height - r;
      x = cx + Math.cos(a) * r;
      y = cy + Math.sin(a) * r;
      angle = a + Math.PI / 2;
    }
    out.x = x + PAD; out.y = y + PAD; out.angle = angle; return out;
  }

  function bodyPoint(d, travel, behind, time, out) {
    const p = borderPoint(d, travel - behind, out);
    // Waves travel down the spine; a quieter neck keeps the face readable.
    const envelope = Math.min(1, behind / 65);
    const headLift = Math.sin(time * 3.2) * 2.8 * Math.max(0, 1 - behind / 70);
    const wave = (Math.sin(behind / 46 - time * 2.6) * 7.5
      + Math.sin(behind / 83 - time * 1.6) * 1.5) * envelope * d.scale + headLift * d.scale;
    p.x -= Math.sin(p.angle) * wave;
    p.y += Math.cos(p.angle) * wave;
    return p;
  }

  function pose(ctx, p, angle, scale, draw) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    draw();
    ctx.restore();
  }

  function stroke(ctx, points, color, width) {
    ctx.beginPath();
    for(let i=0;i<points.length;i++) { const p=points[i]; if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y); }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function segment(ctx, ax, ay, bx, by, color, width) {
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  }

  function claw(ctx, p, angle, side, time, scale) {
    pose(ctx, p, angle, scale, () => {
      ctx.scale(1, side);
      const flutter = Math.sin(time * 3.8) * 2;
      ctx.beginPath();
      ctx.moveTo(0, 3);
      ctx.quadraticCurveTo(-11, 10, -5, 17 + flutter);
      ctx.lineTo(6, 21 + flutter);
      ctx.strokeStyle = "#9c631c";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = "#f7d476";
      ctx.lineWidth = 2.3;
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(3, 20 + flutter);
        ctx.quadraticCurveTo(10 + i * 2, 16 + i * 4 + flutter, 12 + i * 2, 20 + i * 4 + flutter);
        ctx.strokeStyle = "#ffedaf";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    });
  }

  function draw(d, time) {
    if (!d.width || !d.height) return;
    const ctx = d.ctx;
    const ratio = d.ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, d.width + PAD * 2, d.height + PAD * 2);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const scale = d.scale;
    // Span half the frame so the dragon has presence and room to fly.
    const length = d.perimeter * .5;
    const travel = d.width * .62 + time * 76;
    const points = d.points || (d.points = []);
    const tangent = d.tangent || (d.tangent = {});
    let count = 0;
    for (let behind = length; behind >= 0; behind -= 3) {
      const p = bodyPoint(d, travel, behind, time, points[count] || (points[count] = {}));
      const next = bodyPoint(d, travel, behind - 1, time, tangent);
      p.angle = Math.atan2(next.y - p.y, next.x - p.x);
      p.behind = behind;
      const fullness = Math.min(1, (length - behind) / (length * .22));
      p.thickness = scale * (1.5 + 13.5 * Math.pow(fullness, .7)
        + Math.sin(behind / length * Math.PI) * 1.5);
      count++;
    }
    const nose = bodyPoint(d, travel, 0, time, points[count] || (points[count] = {}));
    nose.behind = 0;
    nose.thickness = 15 * scale;
    points.length = count + 1;

    // A soft wake, then tapering bronze/gold segments and a lit belly.
    ctx.shadowColor = "rgba(255, 176, 38, .75)";
    ctx.shadowBlur = 12 * scale;
    stroke(ctx, points, "rgba(246, 180, 47, .16)", 19 * scale);
    ctx.shadowBlur = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      segment(ctx,a.x,a.y,b.x,b.y,"#754213",b.thickness + 2 * scale);
      segment(ctx,a.x,a.y,b.x,b.y,"#dca63d",b.thickness);
      const asin = Math.sin(a.angle) * a.thickness, acos = Math.cos(a.angle) * a.thickness;
      const bsin = Math.sin(b.angle) * b.thickness, bcos = Math.cos(b.angle) * b.thickness;
      segment(ctx,a.x + asin * .24,a.y - acos * .24,b.x + bsin * .24,b.y - bcos * .24,"#f8d87a",b.thickness * .35);
      segment(ctx,a.x - asin * .22,a.y + acos * .22,b.x - bsin * .22,b.y + bcos * .22,"#fff0b8",b.thickness * .25);
    }

    // Three rows of overlapping scales and a flowing flame-shaped dorsal mane.
    for (let i = 2; i < points.length - 5; i += 2) {
      const p = points[i];
      const girth = p.thickness / scale;
      pose(ctx, p, p.angle, scale, () => {
        for (let row = -2; row <= 2; row++) {
          const y = row * girth * .17;
          const stagger = Math.abs(row) % 2 ? 2 : 0;
          ctx.beginPath();
          ctx.moveTo(-3 + stagger, y - 1.7);
          ctx.quadraticCurveTo(1.5 + stagger, y, -3 + stagger, y + 1.7);
          ctx.strokeStyle = row > 0 ? "#af7524" : "#fff0b5";
          ctx.lineWidth = .8;
          ctx.stroke();
        }
        if (i % 4 === 2) {
          const sway = Math.sin(time * 3 - p.behind / 35) * 2.5;
          ctx.beginPath();
          ctx.moveTo(2, -girth * .42);
          ctx.bezierCurveTo(-1, -girth * .6 - 5, -8, -girth * .5 - 10 + sway, -16, -girth * .5 - 8 + sway);
          ctx.quadraticCurveTo(-8, -girth * .5 - 2, -5, -girth * .3);
          const fire = ctx.createLinearGradient(0, -girth * .3, -6, -girth * .5 - 10);
          fire.addColorStop(0, "#b97121");
          fire.addColorStop(.55, "#ecc265");
          fire.addColorStop(1, "#fff1b0");
          ctx.fillStyle = fire;
          ctx.fill();
          ctx.strokeStyle = "#996324";
          ctx.lineWidth = .6;
          ctx.stroke();
        }
      });
    }

    for (const behind of [85 * scale, length * .58]) {
      const p = points.reduce((best, q) => Math.abs(q.behind - behind) < Math.abs(best.behind - behind) ? q : best);
      for (const side of [-1, 1]) claw(ctx, p, p.angle, side, time - behind / 30, scale);
    }

    // A fan of gold fire follows the same border curve, including at corners.
    for (let plume = -3; plume <= 3; plume++) {
      const trail = [];
      for (let step = 0; step <= 12; step++) {
        const p = bodyPoint(d, travel, length + step * 5 * scale, time);
        const spread = Math.sin(step / 12 * Math.PI) * plume * 3.2 * scale;
        p.x -= Math.sin(p.angle) * spread;
        p.y += Math.cos(p.angle) * spread;
        trail.push(p);
      }
      ctx.shadowColor = "#efb73f";
      ctx.shadowBlur = 5 * scale;
      stroke(ctx, trail, plume % 2 ? "#dca83e" : "#ffedac", (plume === 0 ? 2 : 1) * scale);
    }
    ctx.shadowBlur = 0;

    // Sparse drifting embers add depth without obscuring the text inside the card.
    for (let i = 0; i < 22; i++) {
      const age = (time * .45 + i * .618) % 1;
      const p = bodyPoint(d, travel, length * (i / 22) + age * 22, time);
      const drift = (12 + age * 11) * scale;
      p.x += Math.sin(p.angle) * drift;
      p.y -= Math.cos(p.angle) * drift;
      ctx.globalAlpha = Math.sin(age * Math.PI) * .65;
      ctx.fillStyle = "#ffe6a0";
      ctx.beginPath();
      ctx.arc(p.x, p.y, (.6 + (i % 3) * .3) * scale, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Follow the flexing neck and add a distinct head nod even on straight edges.
    const neck = bodyPoint(d, travel, 18 * scale, time);
    const headAngle = Math.atan2(nose.y - neck.y, nose.x - neck.x)
      + Math.sin(time * 3.2) * .18 + Math.sin(time * 1.6) * .04;
    pose(ctx, nose, headAngle, scale, () => window.GoldenDragonHead.draw(ctx, time));
  }

  function hasVisibleDragon() {
    for (const d of dragons.values()) if (allowed(d)) return true;
    return false;
  }

  function animate(now) {
    frame = 0;
    if (document.hidden || motion.matches || !hasVisibleDragon()) return;
    if (now - lastPaint >= 1000 / 30) {
      lastPaint = now;
      for (const d of dragons.values()) if (allowed(d)) draw(d, now / 1000);
    }
    frame = requestAnimationFrame(animate);
  }

  function start() {
    if (!frame && !document.hidden && !motion.matches && hasVisibleDragon()) frame = requestAnimationFrame(animate);
  }

  const visibility = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const d = dragons.get(entry.target);
      if (d) {
        d.visible = entry.isIntersecting;
        if (allowed(d)) draw(d, motion.matches ? 0 : performance.now() / 1000);
      }
    }
    start();
  });

  const resize = new ResizeObserver(entries => {
    for (const entry of entries) {
      const canvas = entry.target.querySelector(".dragon-border");
      const d = dragons.get(canvas);
      if (!d) continue;
      const width = entry.target.clientWidth, height = entry.target.clientHeight, ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (width === d.width && height === d.height && ratio === d.ratio) continue;
      d.width = width; d.height = height;
      if (!d.width || !d.height) continue;
      d.radius = Math.min(parseFloat(getComputedStyle(entry.target).borderRadius) || 16, d.width / 2, d.height / 2);
      d.perimeter = 2 * (d.width + d.height - 4 * d.radius) + TAU * d.radius;
      d.straightWidth = d.width - 2 * d.radius;
      const h = d.height - 2 * d.radius, arc = Math.PI * d.radius / 2;
      d.segments = [d.straightWidth, arc, h, arc, d.straightWidth, arc, h, arc];
      d.scale = d.width < 500 ? .72 : 1;
      d.ratio = ratio;
      canvas.width = Math.round((d.width + PAD * 2) * d.ratio);
      canvas.height = Math.round((d.height + PAD * 2) * d.ratio);
      draw(d, motion.matches ? 0 : performance.now() / 1000);
    }
    start();
  });

  window.GoldenDragonBorder = {
    setOverlay(modal) {
      if (overlay === modal) return;
      overlay = modal;
      if (!hasVisibleDragon()) { cancelAnimationFrame(frame); frame = 0; }
      for (const d of dragons.values()) if (allowed(d)) draw(d, motion.matches ? 0 : performance.now() / 1000);
      start();
    },
    mount(root) {
      // List filters and profile edits replace nodes; dispose their observers immediately.
      for (const [canvas, d] of dragons) if (!canvas.isConnected) {
        visibility.unobserve(canvas);
        resize.unobserve(d.card);
        dragons.delete(canvas);
      }
      root.querySelectorAll(".dragon-border").forEach(canvas => {
        if (dragons.has(canvas)) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const d = { canvas, ctx, card: canvas.parentElement, modal: canvas.closest(".modal"), visible: false, width: 0, height: 0 };
        dragons.set(canvas, d);
        resize.observe(d.card);
        visibility.observe(canvas);
      });
      start();
    },
  };

  motion.addEventListener("change", () => {
    cancelAnimationFrame(frame);
    frame = 0;
    for (const d of dragons.values()) if (allowed(d)) draw(d, motion.matches ? 0 : performance.now() / 1000);
    start();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
    else start();
  });
})();
