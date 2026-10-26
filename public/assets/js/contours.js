
(() => {
  // the legendary hypercam2 watermark xd
  const watermark = document.getElementById("hypercam-watermark");
  if (!watermark) return;

  window.setTimeout(() => {
    watermark.remove();
  }, 4500);

  // contour lines
  const canvas = document.getElementById("contours");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reducedMotion = matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  const spacing = 10;
  const levels = 11;
  const targetFrameTime = 1000 / 30;

  let width = 0;
  let height = 0;
  let dpr = 1;
  let cols = 0;
  let rows = 0;
  let values = new Float32Array(0);
  let time = 0;
  let lastFrame = 0;

  const mouse = {
    x: -10000,
    y: -10000,
    active: false
  };

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    cols = Math.ceil(width / spacing) + 1;
    rows = Math.ceil(height / spacing) + 1;
    values = new Float32Array(cols * rows);

    render();
  }

  function hash(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
  }

  function noise(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);

    return (
      hash(ix, iy) * (1 - u) * (1 - v) +
      hash(ix + 1, iy) * u * (1 - v) +
      hash(ix, iy + 1) * (1 - u) * v +
      hash(ix + 1, iy + 1) * u * v
    );
  }

  function field(x, y) {
    const drift = time * 65;
    const nx = (x + drift) / 260;
    const ny = (y + drift * 0.72) / 260;

    let value =
      noise(nx, ny) +
      noise(nx * 1.8, ny * 1.8) * 0.3 +
      noise(nx * 0.45 - 4, ny * 0.45 + 3) * 0.5;

    if (mouse.active) {
      const dx = x - mouse.x;
      const dy = y - mouse.y;
      const distance = Math.hypot(dx, dy);
      const radius = 130;

      if (distance < radius) {
        const influence = (1 - distance / radius) ** 2;

        value += Math.sin(distance * 0.035) * influence * 0.06;
      }
    }

    return value;
  }

  function interpolate(x1, y1, v1, x2, y2, v2, level) {
    const denominator = v2 - v1;
    const t = Math.abs(denominator) < 1e-9
      ? 0.5
      : Math.max(0, Math.min(1, (level - v1) / denominator));

    return [
      x1 + (x2 - x1) * t,
      y1 + (y2 - y1) * t
    ];
  }

  function render() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    // Calculate the noise field once per frame.
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        values[j * cols + i] = field(
          i * spacing,
          j * spacing
        );
      }
    }

    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();

    for (let levelIndex = 0; levelIndex < levels; levelIndex++) {
      const level = -0.8 + levelIndex * 0.115;

      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const x = i * spacing;
          const y = j * spacing;
          const offset = j * cols + i;

          const a = values[offset];
          const b = values[offset + 1];
          const c = values[offset + cols + 1];
          const d = values[offset + cols];

          const aboveA = a >= level;
          const aboveB = b >= level;
          const aboveC = c >= level;
          const aboveD = d >= level;

          if (
            aboveA === aboveB &&
            aboveB === aboveC &&
            aboveC === aboveD
          ) continue;

          const points = [];

          if (aboveA !== aboveB) {
            points.push(interpolate(
              x, y, a, x + spacing, y, b, level
            ));
          }

          if (aboveB !== aboveC) {
            points.push(interpolate(
              x + spacing, y, b,
              x + spacing, y + spacing, c, level
            ));
          }

          if (aboveC !== aboveD) {
            points.push(interpolate(
              x + spacing, y + spacing, c,
              x, y + spacing, d, level
            ));
          }

          if (aboveD !== aboveA) {
            points.push(interpolate(
              x, y + spacing, d, x, y, a, level
            ));
          }

          for (let k = 0; k + 1 < points.length; k += 2) {
            ctx.moveTo(points[k][0], points[k][1]);
            ctx.lineTo(points[k + 1][0], points[k + 1][1]);
          }
        }
      }
    }

    ctx.stroke();
  }

  function animate(now) {
    if (now - lastFrame < targetFrameTime) {
      requestAnimationFrame(animate);
      return;
    }

    const delta = lastFrame
      ? Math.min((now - lastFrame) / 1000, 0.033)
      : 0;

    lastFrame = now;
    time += delta;
    render();

    requestAnimationFrame(animate);
  }

  canvas.addEventListener("pointermove", event => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
    mouse.active = true;

    if (reducedMotion) render();
  }, { passive: true });

  canvas.addEventListener("pointerleave", () => {
    mouse.active = false;

    if (reducedMotion) render();
  }, { passive: true });

  window.addEventListener("resize", resize, { passive: true });

  resize();

  if (!reducedMotion) {
    requestAnimationFrame(animate);
  }
})();
