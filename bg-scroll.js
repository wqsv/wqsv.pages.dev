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

    styleId: 'bg-scroll-style'
  };


  /* ========================================
     COLOR UTILITIES
  ======================================== */

  function hexToRgb(hex) {
    let value = (hex || '').replace('#', '').trim();

    if (value.length === 3) {
      value = value
        .split('')
        .map((char) => char + char)
        .join('');
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

    let h = 0;
    let s = 0;

    const l = (max + min) / 2;

    if (max !== min) {
      const delta = max - min;

      s = l > 0.5
        ? delta / (2 - max - min)
        : delta / (max + min);

      switch (max) {
        case r:
          h = (g - b) / delta + (g < b ? 6 : 0);
          break;

        case g:
          h = (b - r) / delta + 2;
          break;

        case b:
          h = (r - g) / delta + 4;
          break;
      }

      h *= 60;
    }

    return {
      h: h || 0,
      s: s * 100,
      l: l * 100
    };
  }


  function hslToCss({ h, s, l }) {
    return `hsl(${h.toFixed(2)}, ${s.toFixed(2)}%, ${l.toFixed(2)}%)`;
  }


  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }


  function interpolateHue(start, end, amount) {
    const difference = ((end - start + 540) % 360) - 180;

    return (start + difference * amount + 360) % 360;
  }


  function easeInOutCubic(value) {
    return value < 0.5
      ? 4 * value * value * value
      : 1 - Math.pow(-2 * value + 2, 3) / 2;
  }


  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }


  function isHslClose(a, b, epsilon = 0.05) {
    const hueDifference = Math.abs(
      ((a.h - b.h + 540) % 360) - 180
    );

    return (
      hueDifference <= epsilon * 10 &&
      Math.abs(a.s - b.s) <= epsilon * 100 &&
      Math.abs(a.l - b.l) <= epsilon * 100
    );
  }


  function interpolateHsl(current, target, amount) {
    return {
      h: interpolateHue(current.h, target.h, amount),
      s: lerp(current.s, target.s, amount),
      l: lerp(current.l, target.l, amount)
    };
  }


  /* ========================================
     STYLE SETUP
  ======================================== */

  const root = document.documentElement;

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
        background:
          linear-gradient(
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
     LAYOUT TRACKING
  ======================================== */

  let maxScroll = 0;

  function updateScrollMetrics() {
    const documentHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      document.documentElement.offsetHeight
    );

    const viewportHeight =
      window.innerHeight ||
      document.documentElement.clientHeight ||
      1;

    maxScroll = Math.max(0, documentHeight - viewportHeight);
  }


  function getScrollProgress() {
    const scrollY = Math.max(
      0,
      window.scrollY || window.pageYOffset || 0
    );

    if (maxScroll <= 0) return 0;

    return clamp(scrollY / maxScroll, 0, 1);
  }


  /* ========================================
     COLOR CALCULATION
  ======================================== */

  const topHsl = rgbToHsl(hexToRgb(CONFIG.topColor));
  const endHsl = rgbToHsl(hexToRgb(CONFIG.endColor));

  const hueStep =
    CONFIG.hueSpread / Math.max(1, CONFIG.steps - 1);


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

    const hue = interpolateHue(
      hueA,
      hueB,
      easedProgress
    );

    const lightness = lerp(
      CONFIG.lightnessMin,
      CONFIG.lightnessMax,
      fraction
    );

    let backgroundHsl;

    /* Bottom-of-page blending */
    if (fraction >= CONFIG.bottomBlendStart) {
      const bottomProgress =
        (fraction - CONFIG.bottomBlendStart) /
        Math.max(0.000001, 1 - CONFIG.bottomBlendStart);

      const darkenedTopLightness = Math.max(
        0,
        topHsl.l - CONFIG.topDarkenAtBottom
      );

      backgroundHsl = {
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
          darkenedTopLightness,
          bottomProgress
        )
      };
    } else {
      backgroundHsl = {
        h: hue,
        s: CONFIG.saturation,
        l: lightness
      };
    }

    /* Blend the gradient's end color */
    const mix = Math.min(
      CONFIG.endCrossfadeMax,
      0.02 + fraction * CONFIG.endCrossfadeMax
    );

    const endColor = {
      h: interpolateHue(
        endHsl.h,
        backgroundHsl.h,
        mix
      ),

      s: lerp(
        endHsl.s,
        backgroundHsl.s,
        mix * 0.7
      ),

      l: lerp(
        endHsl.l,
        backgroundHsl.l,
        mix * 0.9
      )
    };

    return {
      bg: backgroundHsl,
      end: endColor
    };
  }


  /* ========================================
     ANIMATION STATE
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

    if (
      bgCss === lastWrittenBg &&
      endCss === lastWrittenEnd
    ) {
      return;
    }

    root.style.setProperty('--bg', bgCss);
    root.style.setProperty('--bg-end', endCss);

    lastWrittenBg = bgCss;
    lastWrittenEnd = endCss;
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

    writeBackgroundVariables();

    const bgFinished = isHslClose(
      currentBg,
      targetBg
    );

    const endFinished = isHslClose(
      currentEnd,
      targetEnd
    );

    if (bgFinished && endFinished) {
      currentBg = { ...targetBg };
      currentEnd = { ...targetEnd };

      writeBackgroundVariables();
      animationFrame = null;

      return;
    }

    animationFrame = requestAnimationFrame(
      animateBackground
    );
  }


  function requestBackgroundUpdate() {
    if (animationFrame !== null) return;

    animationFrame = requestAnimationFrame(
      animateBackground
    );
  }


  /* ========================================
     SCROLL HANDLING
  ======================================== */

  function handleScroll() {
    const progress = getScrollProgress();

    const colors = calculateTargetColors(progress);

    targetBg = colors.bg;
    targetEnd = colors.end;

    requestBackgroundUpdate();
  }


  /* ========================================
     INITIALIZATION
  ======================================== */

  function initialize() {
    createBackgroundStyle();

    // Preserve the exact original colors at the top.
    root.style.setProperty('--bg', CONFIG.topColor);
    root.style.setProperty('--bg-end', CONFIG.endColor);

    lastWrittenBg = CONFIG.topColor;
    lastWrittenEnd = CONFIG.endColor;

    updateScrollMetrics();
    handleScroll();

    window.addEventListener(
      'scroll',
      handleScroll,
      { passive: true }
    );

    window.addEventListener(
      'resize',
      () => {
        updateScrollMetrics();
        handleScroll();
      },
      { passive: true }
    );

    if (window.ResizeObserver) {
      const resizeObserver = new ResizeObserver(() => {
        updateScrollMetrics();
        handleScroll();
      });

      resizeObserver.observe(document.documentElement);
      resizeObserver.observe(document.body);
    }

    if (window.MutationObserver) {
      let resizeTimeout = null;

      const mutationObserver = new MutationObserver(() => {
        clearTimeout(resizeTimeout);

        resizeTimeout = setTimeout(() => {
          updateScrollMetrics();
          handleScroll();
        }, 50);
      });

      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });
    }
  }


  /* ========================================
     START
  ======================================== */

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      initialize,
      { once: true }
    );
  } else {
    initialize();
  }

})();