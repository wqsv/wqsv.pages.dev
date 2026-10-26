
(function () {
  'use strict';

  /* ========================================
     CONFIGURATION
  ======================================== */

  const CONFIG = {
    topColor: '#071025',
    endColor: '#02121b',

    steps: 30,
    hueSpread: 360,
    saturation: 36,

    lightnessMin: 6,
    lightnessMax: 12,

    bottomBlendStart: 0.92,
    topDarkenAtBottom: 8,

    tweenSpeed: 0.22,
    endCrossfadeMax: 0.30,

    styleId: 'bg-scroll-style',
    instanceKey: '__bgScrollController'
  };

  const root = document.documentElement;

  /* ========================================
     COLOR UTILITIES
  ======================================== */

  const clamp = (value, min, max) =>
    Math.max(min, Math.min(max, value));

  const lerp = (start, end, amount) =>
    start + (end - start) * amount;

  function hexToRgb(hex) {
    let value = hex.replace('#', '').trim();

    if (value.length === 3) {
      value = [...value].map(char => char + char).join('');
    }

    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16)
    };
  }

  function rgbToHsl({ r, g, b }) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    const l = (max + min) / 2;

    let h = 0;
    let s = 0;

    if (delta !== 0) {
      s = delta / (1 - Math.abs(2 * l - 1));

      switch (max) {
        case r:
          h = ((g - b) / delta) % 6;
          break;
        case g:
          h = (b - r) / delta + 2;
          break;
        default:
          h = (r - g) / delta + 4;
      }

      h = (h * 60 + 360) % 360;
    }

    return {
      h,
      s: s * 100,
      l: l * 100
    };
  }

  const hslToCss = ({ h, s, l }) =>
    `hsl(${h.toFixed(2)}, ${s.toFixed(2)}%, ${l.toFixed(2)}%)`;

  function interpolateHue(start, end, amount) {
    const difference = ((end - start + 540) % 360) - 180;

    return (start + difference * amount + 360) % 360;
  }

  function interpolateHsl(current, target, amount) {
    return {
      h: interpolateHue(current.h, target.h, amount),
      s: lerp(current.s, target.s, amount),
      l: lerp(current.l, target.l, amount)
    };
  }

  function easeInOutCubic(value) {
    return value < 0.5
      ? 4 * value ** 3
      : 1 - ((-2 * value + 2) ** 3) / 2;
  }

  // Preserve the original completion thresholds.
  function isHslClose(a, b) {
    const hueDifference = Math.abs(
      ((a.h - b.h + 540) % 360) - 180
    );

    return (
      hueDifference <= 0.5 &&
      Math.abs(a.s - b.s) <= 5 &&
      Math.abs(a.l - b.l) <= 5
    );
  }

  /* ========================================
     PRECOMPUTED COLORS
  ======================================== */

  const topHsl = rgbToHsl(hexToRgb(CONFIG.topColor));
  const endHsl = rgbToHsl(hexToRgb(CONFIG.endColor));

  const hueStep =
    CONFIG.hueSpread / Math.max(1, CONFIG.steps - 1);

  /* ========================================
     STYLES
  ======================================== */

  function createBackgroundStyle() {
    let style = document.getElementById(CONFIG.styleId);

    if (style) return style;

    style = document.createElement('style');
    style.id = CONFIG.styleId;

    style.textContent = `
      :root {
        --bg: ${CONFIG.topColor};
        --bg-end: ${CONFIG.endColor};
      }

      html,
      body {
        background: linear-gradient(
          180deg,
          var(--bg) 0%,
          var(--bg-end) 140%
        ) !important;

        will-change: background;
      }
    `;

    document.head.appendChild(style);

    return style;
  }

  /* ========================================
     SCROLL METRICS
  ======================================== */

  let maxScroll = 0;

  function updateScrollMetrics() {
    const html = document.documentElement;
    const body = document.body;

    const documentHeight = Math.max(
      html.scrollHeight,
      body?.scrollHeight || 0,
      html.offsetHeight,
      body?.offsetHeight || 0
    );

    const viewportHeight =
      window.innerHeight || html.clientHeight || 1;

    maxScroll = Math.max(0, documentHeight - viewportHeight);
  }

  function getScrollProgress() {
    if (maxScroll <= 0) return 0;

    const scrollY = Math.max(
      0,
      window.scrollY || window.pageYOffset || 0
    );

    return clamp(scrollY / maxScroll, 0, 1);
  }

  /* ========================================
     TARGET COLOR CALCULATION
  ======================================== */

  function calculateTargetColors(progress) {
    if (progress <= 0) {
      return {
        bg: { ...topHsl },
        end: { ...endHsl }
      };
    }

    const fraction = clamp(progress, 0, 1);
    const position = fraction * (CONFIG.steps - 1);

    const stepIndex = Math.floor(position);
    const localProgress = position - stepIndex;
    const easedProgress = easeInOutCubic(localProgress);

    const hueA =
      (topHsl.h + stepIndex * hueStep) % 360;

    const hueB =
      (
        topHsl.h +
        Math.min(stepIndex + 1, CONFIG.steps - 1) * hueStep
      ) % 360;

    const hue = interpolateHue(hueA, hueB, easedProgress);

    const lightness = lerp(
      CONFIG.lightnessMin,
      CONFIG.lightnessMax,
      fraction
    );

    let bg;

    // Blend back toward the dark top color near the bottom.
    if (fraction >= CONFIG.bottomBlendStart) {
      const bottomProgress =
        (fraction - CONFIG.bottomBlendStart) /
        Math.max(0.000001, 1 - CONFIG.bottomBlendStart);

      bg = {
        h: interpolateHue(
          hue,
          topHsl.h,
          bottomProgress * 0.85
        ),

        s: lerp(
          CONFIG.saturation,
          CONFIG.saturation * 0.92,
          bottomProgress
        ),

        l: lerp(
          lightness,
          Math.max(0, topHsl.l - CONFIG.topDarkenAtBottom),
          bottomProgress
        )
      };
    } else {
      bg = {
        h: hue,
        s: CONFIG.saturation,
        l: lightness
      };
    }

    // Gradually tint the gradient's end color.
    const mix = Math.min(
      CONFIG.endCrossfadeMax,
      0.02 + fraction * CONFIG.endCrossfadeMax
    );

    const end = {
      h: interpolateHue(endHsl.h, bg.h, mix),
      s: lerp(endHsl.s, bg.s, mix * 0.7),
      l: lerp(endHsl.l, bg.l, mix * 0.9)
    };

    return { bg, end };
  }

  /* ========================================
     ANIMATION
  ======================================== */

  let currentBg = { ...topHsl };
  let currentEnd = { ...endHsl };

  let targetBg = { ...topHsl };
  let targetEnd = { ...endHsl };

  let animationFrame = null;
  let lastWrittenBg = '';
  let lastWrittenEnd = '';

  function writeBackgroundVariables() {
    const bgCss = hslToCss(currentBg);
    const endCss = hslToCss(currentEnd);

    if (bgCss !== lastWrittenBg) {
      root.style.setProperty('--bg', bgCss);
      lastWrittenBg = bgCss;
    }

    if (endCss !== lastWrittenEnd) {
      root.style.setProperty('--bg-end', endCss);
      lastWrittenEnd = endCss;
    }
  }

  function animateBackground() {
    currentBg = interpolateHsl(
      currentBg,
      targetBg,
      CONFIG.tweenSpeed
    );

    currentEnd = interpolateHsl(
      currentEnd,
      targetEnd,
      CONFIG.tweenSpeed
    );

    const bgFinished = isHslClose(currentBg, targetBg);
    const endFinished = isHslClose(currentEnd, targetEnd);

    if (bgFinished && endFinished) {
      currentBg = { ...targetBg };
      currentEnd = { ...targetEnd };

      writeBackgroundVariables();
      animationFrame = null;
      return;
    }

    writeBackgroundVariables();

    animationFrame = requestAnimationFrame(animateBackground);
  }

  function requestBackgroundUpdate() {
    if (animationFrame !== null) return;

    animationFrame = requestAnimationFrame(animateBackground);
  }

  /* ========================================
     UPDATE HANDLERS
  ======================================== */

  function updateBackground() {
    const colors = calculateTargetColors(getScrollProgress());

    targetBg = colors.bg;
    targetEnd = colors.end;

    requestBackgroundUpdate();
  }

  function handleScroll() {
    updateBackground();
  }

  function handleResize() {
    updateScrollMetrics();
    updateBackground();
  }

  /* ========================================
     LIFECYCLE & CLEANUP
  ======================================== */

  function initialize() {
    createBackgroundStyle();

    // Retain the exact configured colors at initialization.
    root.style.setProperty('--bg', CONFIG.topColor);
    root.style.setProperty('--bg-end', CONFIG.endColor);

    lastWrittenBg = CONFIG.topColor;
    lastWrittenEnd = CONFIG.endColor;

    updateScrollMetrics();
    updateBackground();

    window.addEventListener('scroll', handleScroll, {
      passive: true
    });

    window.addEventListener('resize', handleResize, {
      passive: true
    });

    let resizeObserver = null;
    let mutationObserver = null;
    let resizeTimeout = null;

    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(handleResize);

      resizeObserver.observe(root);

      if (document.body) {
        resizeObserver.observe(document.body);
      }
    }

    if ('MutationObserver' in window && document.body) {
      mutationObserver = new MutationObserver(() => {
        clearTimeout(resizeTimeout);

        resizeTimeout = setTimeout(handleResize, 50);
      });

      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'open']
      });
    }

    // Allow safe reinitialization if this script is executed again.
    window[CONFIG.instanceKey] = {
      destroy() {
        window.removeEventListener('scroll', handleScroll);
        window.removeEventListener('resize', handleResize);

        resizeObserver?.disconnect();
        mutationObserver?.disconnect();

        clearTimeout(resizeTimeout);

        if (animationFrame !== null) {
          cancelAnimationFrame(animationFrame);
          animationFrame = null;
        }

        if (window[CONFIG.instanceKey] === this) {
          delete window[CONFIG.instanceKey];
        }
      }
    };
  }

  /* ========================================
     START
  ======================================== */

  // Dispose of the previous instance before starting another.
  window[CONFIG.instanceKey]?.destroy();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, {
      once: true
    });
  } else {
    initialize();
  }
})();
