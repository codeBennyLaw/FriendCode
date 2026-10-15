/* Articulated, resolution-independent gold dragon head; local +X points forward. */
(() => {
  "use strict";
  const TAU = Math.PI * 2;
  function gradient(ctx, x0, y0, x1, y1, colors) {
    const fill = ctx.createLinearGradient(x0, y0, x1, y1);
    colors.forEach((color, index) => fill.addColorStop(index / (colors.length - 1), color));
    return fill;
  }
  function shape(ctx, trace, fill, stroke = "#8f581b", width = .8) {
    ctx.beginPath(); trace(ctx);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  }
  function curve(ctx, trace, color, width = 1) { shape(ctx, trace, null, color, width); }
  function poseAt(time) {
    const cycle = ((time % 5.8) + 5.8) % 5.8;
    return {
      jaw: .11 + .095 * Math.sin(time * 2.2) + .025 * Math.sin(time * 4.4),
      blink: 1 - .94 * Math.exp(-Math.pow((cycle - 5.5) / .085, 2)),
      ear: Math.sin(time * 2.7) * .12 + Math.sin(time * 5.1) * .025,
      horn: Math.sin(time * 1.7) * .025,
      breath: Math.sin(time * 2.2),
    };
  }
  function horn(ctx, x, y, turn, time, far) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(turn);
    if (far) ctx.globalAlpha = .78;
    const ivory = gradient(ctx, -15, -36, 5, 1, ["#fff5c9", "#f0c46a", "#ad7029"]);
    const trace = c => {
      c.moveTo(-3, 3); c.bezierCurveTo(-7, -4, -9, -14, -16, -22);
      c.bezierCurveTo(-20, -26, -22, -31, -21, -36);
      c.bezierCurveTo(-17, -29, -13, -27, -9, -24);
      c.bezierCurveTo(-11, -30, -10, -35, -7, -39);
      c.bezierCurveTo(-8, -29, -3, -25, -1, -20);
      c.bezierCurveTo(2, -24, 3, -29, 3, -32);
      c.bezierCurveTo(7, -25, 3, -17, -1, -14);
      c.bezierCurveTo(1, -8, 2, -2, 3, 2); c.closePath();
    };
    shape(ctx, trace, ivory, "#c58c36", .75);
    curve(ctx, c => { c.moveTo(0, 2); c.bezierCurveTo(-5, -12, -8, -22, -18, -31); }, "#fff0b0", .8);
    for (let i = 0; i < 5; i++) curve(ctx, c => { const y = -i * 3 - 1; c.moveTo(-4 - i * .35, y); c.quadraticCurveTo(-1, y + 1, 1 - i * .45, y - 1); }, "rgba(111,65,18,.4)", .6);
    ctx.restore();
  }
  function mane(ctx, time, far = false) {
    const strands = far ? 7 : 10;
    for (let i = strands - 1; i >= 0; i--) {
      const rootY = -18 + i * (far ? 5 : 3.8);
      const sway = Math.sin(time * 3.4 - i * .58) * 3 + Math.sin(time * 1.7 - i) * 1.2;
      const rootX = -16 + Math.abs(rootY) * .14;
      const tipX = -39 - (i % 3) * 3;
      const tipY = rootY + (i < 4 ? -12 : 13) + sway;
      const fill = gradient(ctx, rootX, rootY, tipX, tipY, far ? ["#9b5e1d", "#d6a245", "#f5d783"] : ["#b57422", "#f5cf72", "#fff0ae"]);
      shape(ctx, c => {
        c.moveTo(rootX + 7, rootY - 2);
        c.bezierCurveTo(rootX - 10, rootY - 8, tipX + 5, tipY + 7, tipX, tipY);
        c.bezierCurveTo(tipX + 8, tipY + 14, rootX - 8, rootY + 7, rootX + 6, rootY + 3);
        c.closePath();
      }, fill, "rgba(132,78,20,.7)", .65);
      curve(ctx, c => { c.moveTo(rootX + 3, rootY); c.bezierCurveTo(rootX - 12, rootY + 1, tipX + 10, tipY + 7, tipX + 2, tipY + 2); }, "rgba(255,239,177,.8)", .55);
    }
  }
  function ear(ctx, time, angle, far) {
    ctx.save(); ctx.translate(-15, far ? -13 : -1); ctx.rotate(angle + (far ? -.35 : .15));
    shape(ctx, c => {
      c.moveTo(1, -3); c.bezierCurveTo(-8, -9, -15, -7, -25, -14);
      c.bezierCurveTo(-23, -3, -15, 6, -2, 5); c.closePath();
    }, gradient(ctx, -8, -12, -5, 7, ["#ffe9a0", "#d99e38", "#8e4e19"]), "#bc8530", .8);
    curve(ctx, c => { c.moveTo(-2, 0); c.quadraticCurveTo(-14, -1, -21, -10); }, "#ffdf89", .9);
    ctx.restore();
  }
  function jaw(ctx, amount) {
    ctx.save(); ctx.translate(-3, 7); ctx.rotate(amount);
    shape(ctx, c => {
      c.moveTo(0, -1); c.bezierCurveTo(9, 0, 23, 4, 34, 0);
      c.bezierCurveTo(37, 4, 31, 9, 22, 10); c.lineTo(5, 9);
      c.bezierCurveTo(-1, 8, -6, 4, -6, 1); c.closePath();
    }, gradient(ctx, 0, 0, 0, 11, ["#e7ae49", "#fff0a9", "#b57b27"]));
    curve(ctx, c => { c.moveTo(3, 1); c.quadraticCurveTo(19, 6, 31, 2); }, "#6c3518", 1.2);
    shape(ctx, c => { c.moveTo(22, 3); c.quadraticCurveTo(24, -1, 24, -4); c.lineTo(27, 2); c.closePath(); }, "#fff4c8", "#ce9f49", .45);
    for (let i = 0; i < 4; i++) curve(ctx, c => { c.moveTo(6 + i * 4, 6); c.lineTo(8 + i * 4, 8); }, "#c08b36", .65);
    ctx.restore();
  }
  function beard(ctx, time, jawAngle) {
    ctx.save(); ctx.translate(-1, 14); ctx.rotate(jawAngle * .55);
    for (let i = 0; i < 7; i++) {
      const sway = Math.sin(time * 3 - i * .6) * 4;
      const x = i * 2 - 4, length = 14 + (i % 3) * 3;
      curve(ctx, c => {
        c.moveTo(x, 0); c.bezierCurveTo(x + 5, 6, x - 11 + sway, length - 1, x - 16 + sway, length);
      }, i % 2 ? "#fff0b4" : "#dca84a", i % 2 ? .8 : 1.4);
    }
    ctx.restore();
  }
  function whiskers(ctx, time) {
    for (const side of [-1, 1]) {
      const wave = Math.sin(time * 2.6 + side * .8), lag = Math.sin(time * 2.6 - 1 + side * .8);
      const trace = c => {
        c.moveTo(31, side < 0 ? -1 : 4);
        c.bezierCurveTo(47, side * (10 + wave * 3), 44, side * (27 + lag * 4), 60, side * (23 + lag * 3));
        c.bezierCurveTo(74, side * (17 + wave * 3), 64, side * (5 + lag * 4), 58, side * (11 + wave * 3));
      };
      curve(ctx, trace, "rgba(97,53,17,.75)", 2.1);
      curve(ctx, trace, side < 0 ? "#ffe9a5" : "#f5cb70", .95);
    }
  }
  function face(ctx, pose) {
    shape(ctx, c => {
      c.moveTo(-24, -5); c.bezierCurveTo(-21, -16, -11, -22, 0, -18);
      c.bezierCurveTo(8, -17, 13, -10, 18, -6); c.quadraticCurveTo(24, -6, 28, -7);
      c.bezierCurveTo(36, -9, 40, -3, 37, 3); c.quadraticCurveTo(29, 8, 20, 5);
      c.bezierCurveTo(13, 6, 9, 14, -2, 14); c.bezierCurveTo(-17, 15, -24, 5, -24, -5); c.closePath();
    }, gradient(ctx, -10, -22, 4, 16, ["#fff1b3", "#e7b24c", "#a6641e", "#f2ce78"]), "#8e5318", 1);
    // Curved cheek plates and offset rows of small, individually lit scales.
    for (let row = 0; row < 4; row++) for (let i = 0; i < 4; i++) {
      const x = -19 + i * 5 + (row % 2) * 2, y = -11 + row * 5;
      curve(ctx, c => { c.moveTo(x, y - 1.5); c.quadraticCurveTo(x + 4, y + 1, x + 1, y + 3); }, row < 2 ? "#fff0a5" : "#c28b32", .6);
    }
    curve(ctx, c => { c.moveTo(-12, 6); c.bezierCurveTo(-1, 9, 4, 3, 7, -2); }, "#85501d", 1);
    curve(ctx, c => { c.moveTo(-10, 8); c.quadraticCurveTo(0, 12, 6, 6); }, "#ffe8a1", 1);
    curve(ctx, c => { c.moveTo(9, 3); c.quadraticCurveTo(21, 4, 34, 2); }, "#704017", 1);
    // A small curved fang, raised nose pad, and nostril make the profile readable at 1x.
    shape(ctx, c => { c.moveTo(25, 4); c.quadraticCurveTo(27, 13, 30, 13); c.lineTo(29, 3); c.closePath(); }, "#fff6d3", "#b98733", .6);
    shape(ctx, c => { c.ellipse(31, -3, 5, 3.7, -.15, 0, TAU); }, "#f5d78c", "#bc8230", .65);
    shape(ctx, c => { c.ellipse(33, -3.7, 1.8, 1, -.25, 0, TAU); }, "#603018", null);
    // Blink the actual eyelid/iris, not the entire head.
    ctx.save(); ctx.translate(8, -7.5); ctx.scale(1, pose.blink);
    shape(ctx, c => { c.moveTo(-5, 0); c.quadraticCurveTo(0, -4.5, 5, -1); c.quadraticCurveTo(1, 3.6, -5, 0); }, "#fff4be", "#754017", .8);
    shape(ctx, c => { c.ellipse(.7, -.5, 2, 2.6, .2, 0, TAU); }, "#d76c1e", null);
    shape(ctx, c => { c.ellipse(1.2, -.5, .75, 2, .2, 0, TAU); }, "#28140c", null);
    shape(ctx, c => { c.arc(1, -1.5, .55, 0, TAU); }, "#fffbe7", null); ctx.restore();
    curve(ctx, c => { c.moveTo(-1, -10 + pose.breath * .3); c.quadraticCurveTo(7, -16, 16, -9); }, "#fff1aa", 2.1);
    curve(ctx, c => { c.moveTo(-5, -14); c.quadraticCurveTo(4, -19, 11, -13); }, "#bd842a", .9);
  }
  function draw(ctx, time) {
    const pose = poseAt(time);
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    mane(ctx, time + .6, true);
    horn(ctx, -6, -15, -.18 + pose.horn * .6, time, true);
    ear(ctx, time, -pose.ear * .7, true);
    mane(ctx, time);
    // The throat follows the existing spine into the cheek without a rectangular image edge.
    shape(ctx, c => { c.moveTo(-27, -7); c.quadraticCurveTo(-6, -11, 11, 3); c.lineTo(22, 13); c.quadraticCurveTo(-9, 21, -27, 6); c.closePath(); }, gradient(ctx, -12, -8, -12, 15, ["#bf8029", "#edbf63", "#fff0a9"]));
    shape(ctx, c => { c.moveTo(-1, 3); c.lineTo(37, 2); c.lineTo(34, 14); c.lineTo(0, 16); c.closePath(); }, "#432115", null);
    beard(ctx, time, pose.jaw);
    jaw(ctx, pose.jaw);
    face(ctx, pose);
    ear(ctx, time, pose.ear, false);
    horn(ctx, -12, -15, .12 + pose.horn, time, false);
    whiskers(ctx, time);
    ctx.restore();
  }
  window.GoldenDragonHead = Object.freeze({ draw });
})();
