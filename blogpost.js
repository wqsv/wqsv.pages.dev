(function () {
  'use strict';

  function onDOM(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function safeLog(...args) {
    if (window.console && console.warn) console.warn(...args);
  }

  // load an external script and return a Promise
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ' + url));
      document.head.appendChild(s);
    });
  }

  onDOM(function () {
    try {
      // inject current year
      const y = document.getElementById('year');
      if (y) y.textContent = new Date().getFullYear();

      // normalize <br> in paragraphs on small screens
      if (window.innerWidth <= 720) {
        document.querySelectorAll('.article-body p').forEach(p => {
          p.innerHTML = p.innerHTML.replace(/<br\s*\/?>/gi, ' ');
        });
      }

      // nrmalize <br> inside code blocks to real newlines and capture original raw code into data-raw for copy
      const codeEls = Array.from(document.querySelectorAll('pre code'));
      codeEls.forEach(codeEl => {
        codeEl.innerHTML = codeEl.innerHTML.replace(/<br\s*\/?>/gi, '\n');
        const raw = codeEl.textContent.replace(/\r\n/g, '\n');
        codeEl.dataset.raw = raw;
      });

      // load hljs and stuff
      const lineNumbersUrl = 'https://cdnjs.cloudflare.com/ajax/libs/highlightjs-line-numbers.js/2.8.0/highlightjs-line-numbers.min.js';

      const ensureLineNumbers = (async () => {
        if (!window.hljs) {
          await loadScript('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js');
        }
        if (!window.hljs || typeof window.hljs.lineNumbersBlock !== 'function') {
          await loadScript(lineNumbersUrl);
        }
      })();

      // add line numbers
      ensureLineNumbers.then(() => {
        try {
          if (window.hljs && typeof hljs.highlightAll === 'function') {
            hljs.highlightAll();
          } else if (window.hljs && typeof hljs.highlightElement === 'function') {
            codeEls.forEach(el => hljs.highlightElement(el));
          }

          codeEls.forEach(el => {
            try {
              if (typeof hljs.lineNumbersBlock === 'function') {
                hljs.lineNumbersBlock(el);
              }
            } catch (e) { /* non-fatal */ }
          });
        } catch (err) {
          safeLog('hljs highlight/line numbers failed', err);
        }

        // add copy btn wrappers
        codeEls.forEach(codeEl => {
          const pre = codeEl.closest('pre');
          if (!pre) return;
          if (pre.parentElement && pre.parentElement.classList.contains('code-wrapper')) return;

          const wrapper = document.createElement('div');
          wrapper.className = 'code-wrapper';
          pre.parentNode.insertBefore(wrapper, pre);
          wrapper.appendChild(pre);

          const btn = document.createElement('button');
          btn.className = 'pre-copy-btn';
          btn.type = 'button';
          btn.textContent = 'Copy';
          wrapper.appendChild(btn);

          btn.addEventListener('click', async () => {
            try {
              const raw = codeEl.dataset.raw || codeEl.textContent;
              await navigator.clipboard.writeText(raw);
              btn.textContent = 'Copied!';
              setTimeout(() => btn.textContent = 'Copy', 1400);
            } catch (e) {
              safeLog('copy failed', e);
              btn.textContent = 'Err';
              setTimeout(() => btn.textContent = 'Copy', 1200);
            }
          });
        });

      }).catch(err => {
        safeLog('line numbers plugin failed to load', err);

        try { if (window.hljs && typeof hljs.highlightAll === 'function') hljs.highlightAll(); } catch(e){}

        codeEls.forEach(codeEl => {
          const pre = codeEl.closest('pre');
          if (!pre) return;
          if (pre.parentElement && pre.parentElement.classList.contains('code-wrapper')) return;

          const wrapper = document.createElement('div');
          wrapper.className = 'code-wrapper';
          pre.parentNode.insertBefore(wrapper, pre);
          wrapper.appendChild(pre);

          const btn = document.createElement('button');
          btn.className = 'pre-copy-btn';
          btn.type = 'button';
          btn.textContent = 'Copy';
          wrapper.appendChild(btn);

          btn.addEventListener('click', async () => {
            try {
              const raw = codeEl.dataset.raw || codeEl.textContent;
              await navigator.clipboard.writeText(raw);
              btn.textContent = 'Copied!';
              setTimeout(() => btn.textContent = 'Copy', 1400);
            } catch (e) {
              safeLog('copy failed', e);
              btn.textContent = 'Err';
              setTimeout(() => btn.textContent = 'Copy', 1200);
            }
          });
        });
      });

    } catch (e) {
      safeLog('Blogpost JS failed', e);
    }
  });


const MIN_SCALE = 1;
const MAX_SCALE = 6;
const SCALE_STEP = 1.25;

let scale = 1;
let tx = 0, ty = 0;
let baseDisplayWidth = 0, baseDisplayHeight = 0;
let pointers = new Map();
let lastTouchDistance = 0;
let isPanning = false;
let panStartX = 0, panStartY = 0;
let panPointerStartX = 0, panPointerStartY = 0;


let overlay = document.querySelector('.img-overlay');
if (!overlay) {
  overlay = document.createElement('div');
  overlay.className = 'img-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.innerHTML = `
    <div class="img-viewer" aria-hidden="false">
      <img class="viewer-img" alt="" draggable="false" />
    </div>
    <div class="controls" aria-hidden="false">
      <button class="close-btn" aria-label="Close (Esc)">✕</button>
      <button class="zoom-in-btn" aria-label="Zoom in">+</button>
      <button class="zoom-out-btn" aria-label="Zoom out">-</button>
      <button class="fit-btn" aria-label="Fit to screen">Fit</button>
    </div>
    <div class="hint">Drag to pan · Pinch or wheel to zoom · Esc to close</div>
  `;
  document.body.appendChild(overlay);
}

let viewer = overlay.querySelector('.img-viewer');
let imgEl = overlay.querySelector('img.viewer-img');
let closeBtn = overlay.querySelector('.close-btn');
let zoomInBtn = overlay.querySelector('.zoom-in-btn');
let zoomOutBtn = overlay.querySelector('.zoom-out-btn');
let fitBtn = overlay.querySelector('.fit-btn');

if (!viewer || !imgEl) {
  console.warn('Image viewer: critical elements missing; image viewer will be disabled.');
  viewer = viewer || document.createElement('div');
  imgEl = imgEl || document.createElement('img');
}

imgEl.setAttribute('draggable', 'false');
imgEl.addEventListener('dragstart', e => e.preventDefault());

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function updateTransform() {
  imgEl.style.transformOrigin = 'center center';
  imgEl.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
}

function computeBoundsAndClamp() {
  const vRect = viewer.getBoundingClientRect();
  const viewerW = vRect.width;
  const viewerH = vRect.height;

  if (!baseDisplayWidth || !baseDisplayHeight) {
    const prevTransform = imgEl.style.transform;
    imgEl.style.transform = `translate(0px, 0px) scale(1)`;
    const r = imgEl.getBoundingClientRect();
    baseDisplayWidth = r.width;
    baseDisplayHeight = r.height;
    imgEl.style.transform = prevTransform;
  }

  const scaledW = baseDisplayWidth * scale;
  const scaledH = baseDisplayHeight * scale;
  const maxTx = Math.max(0, (scaledW - viewerW) / 2);
  const maxTy = Math.max(0, (scaledH - viewerH) / 2);

  tx = clamp(tx, -maxTx, maxTx);
  ty = clamp(ty, -maxTy, maxTy);

  updateTransform();

  const TOLERANCE = 0;

  const imgRect = imgEl.getBoundingClientRect();

  if (imgRect.width <= viewerW + 1) {
    tx = 0;
  } else {
    if (imgRect.left > vRect.left + TOLERANCE) {
      tx += (vRect.left + TOLERANCE) - imgRect.left;
    } else if (imgRect.right < vRect.right - TOLERANCE) {
      tx += (vRect.right - TOLERANCE) - imgRect.right;
    }
  }

  if (imgRect.height <= viewerH + 1) {
    ty = 0;
  } else {
    if (imgRect.top > vRect.top + TOLERANCE) {
      ty += (vRect.top + TOLERANCE) - imgRect.top;
    } else if (imgRect.bottom < vRect.bottom - TOLERANCE) {
      ty += (vRect.bottom - TOLERANCE) - imgRect.bottom;
    }
  }

  tx = clamp(tx, -maxTx, maxTx);
  ty = clamp(ty, -maxTy, maxTy);

  updateTransform();

  if (scale <= 1.0001) {
    scale = 1;
    tx = 0;
    ty = 0;
    updateTransform();
  }
}

function zoomTo(scaleFactor, clientX, clientY) {
  if (!clientX || !clientY) {
    const vRect = viewer.getBoundingClientRect();
    clientX = vRect.left + vRect.width / 2;
    clientY = vRect.top + vRect.height / 2;
  }

  const prevScale = scale;
  let nextScale = prevScale * scaleFactor;
  nextScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  const effectiveFactor = nextScale / prevScale;
  if (Math.abs(effectiveFactor - 1) < 1e-6) return; // nothing to do

  const vRect = viewer.getBoundingClientRect();
  const viewCenterX = vRect.left + vRect.width / 2;
  const viewCenterY = vRect.top + vRect.height / 2;

  const offsetX = clientX - viewCenterX;
  const offsetY = clientY - viewCenterY;

  // newT = T + (Q - C)/prevScale * (1/effectiveFactor - 1)
  tx = tx + (offsetX / prevScale) * (1 / effectiveFactor - 1);
  ty = ty + (offsetY / prevScale) * (1 / effectiveFactor - 1);

  scale = nextScale;

  computeBoundsAndClamp();
}

function fitToScreen() {
  scale = 1;
  tx = 0; ty = 0;
  baseDisplayWidth = 0; // recompute on next measure
  computeBoundsAndClamp();
}

function openOverlay(sourceImg, clickEvent) {
  imgEl.src = sourceImg.currentSrc || sourceImg.src;
  imgEl.alt = sourceImg.alt || '';
  scale = 1;
  tx = 0; ty = 0;
  baseDisplayWidth = 0; baseDisplayHeight = 0;
  updateTransform();

  imgEl.onload = () => {
    // measure the base display size at scale === 1
    const prev = imgEl.style.transform;
    imgEl.style.transform = `translate(0px, 0px) scale(1)`;
    const br = imgEl.getBoundingClientRect();
    baseDisplayWidth = br.width;
    baseDisplayHeight = br.height;
    imgEl.style.transform = prev;

    // if user clicked a point, zoom slightly so it feels focused (optional)
    if (clickEvent) {
      // small immediate zoom focusing on the tapped point (but keep at least scale 1)
      // we don't automatically zoom to 2x, we just keep origin for subsequent zoom operations
      // no immediate scale change here but computeBounds so panning/zoom math is correct
    }

    computeBoundsAndClamp();
  };

  overlay.classList.add('open');
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  overlay.setAttribute('tabindex', '-1');
  overlay.focus();
}

function closeOverlay() {
  overlay.classList.remove('open');
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
  imgEl.src = '';
  pointers.clear();
  lastTouchDistance = 0;
  isPanning = false;
}

viewer.addEventListener('pointerdown', (e) => {
  viewer.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 1) {
    isPanning = true;
    panPointerStartX = e.clientX;
    panPointerStartY = e.clientY;
    panStartX = tx;
    panStartY = ty;
  } else if (pointers.size === 2) {
    const it = pointers.values();
    const a = it.next().value;
    const b = it.next().value;
    lastTouchDistance = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

viewer.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 1 && isPanning) {
    const dx = e.clientX - panPointerStartX;
    const dy = e.clientY - panPointerStartY;
    tx = panStartX + dx;
    ty = panStartY + dy;
    computeBoundsAndClamp();
  } else if (pointers.size === 2) {
    const it = Array.from(pointers.values());
    const a = it[0];
    const b = it[1];
    const newDist = Math.hypot(a.x - b.x, a.y - b.y);
    if (lastTouchDistance > 0) {
      const factor = newDist / lastTouchDistance;
      const centerX = (a.x + b.x) / 2;
      const centerY = (a.y + b.y) / 2;
      zoomTo(factor, centerX, centerY);
    }
    lastTouchDistance = newDist;

    const centerX = (a.x + b.x) / 2;
    const centerY = (a.y + b.y) / 2;
  }
});

function endPointer(id) {
  try { viewer.releasePointerCapture(id); } catch (_) {}
  pointers.delete(id);

  if (pointers.size < 2) {
    lastTouchDistance = 0;
  }
  if (pointers.size === 0) {
    isPanning = false;
  } else if (pointers.size === 1) {
    const rem = pointers.values().next().value;
    panPointerStartX = rem.x;
    panPointerStartY = rem.y;
    panStartX = tx;
    panStartY = ty;
    isPanning = true;
  }
}

viewer.addEventListener('pointerup', e => endPointer(e.pointerId));
viewer.addEventListener('pointercancel', e => endPointer(e.pointerId));
viewer.addEventListener('pointerleave', e => {
  if (pointers.has(e.pointerId)) endPointer(e.pointerId);
});

viewer.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY > 0 ? (1 / SCALE_STEP) : SCALE_STEP;
  zoomTo(factor, e.clientX, e.clientY);
}, { passive: false });

viewer.addEventListener('dblclick', (e) => {
  if (scale <= 1.01) {
    zoomTo(2, e.clientX, e.clientY);
  } else {
    fitToScreen();
  }
});

overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeOverlay();
});

document.addEventListener('keydown', (e) => {
  if (!overlay.classList.contains('open')) return;
  if (e.key === 'Escape') closeOverlay();
  if (e.key === '+' || e.key === '=') zoomTo(SCALE_STEP, window.innerWidth / 2, window.innerHeight / 2);
  if (e.key === '-') zoomTo(1 / SCALE_STEP, window.innerWidth / 2, window.innerHeight / 2);
  if (e.key === '0') fitToScreen();
});

closeBtn.addEventListener('click', closeOverlay);
zoomInBtn.addEventListener('click', () => zoomTo(SCALE_STEP, window.innerWidth / 2, window.innerHeight / 2));
zoomOutBtn.addEventListener('click', () => zoomTo(1 / SCALE_STEP, window.innerWidth / 2, window.innerHeight / 2));
fitBtn.addEventListener('click', fitToScreen);

function initImageZoomImproved() {
  const imgs = document.querySelectorAll('.article-body img');
  imgs.forEach(img => {
    if (img.dataset.zoomAttached) return;
    img.style.cursor = 'zoom-in';
    img.addEventListener('click', (ev) => {
      ev.preventDefault();
      openOverlay(img, ev);
    });
    img.dataset.zoomAttached = '1';
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initImageZoomImproved);
} else { initImageZoomImproved(); }
const ro2 = new MutationObserver(initImageZoomImproved);
ro2.observe(document.body, { childList: true, subtree: true });

window.addEventListener('resize', () => {
  baseDisplayWidth = 0;
  baseDisplayHeight = 0;
  computeBoundsAndClamp();
});


})();


/* ========================================
   TABLE OF CONTENTS / INDEX EFFECTS
======================================== */

(function initializeIndexEffects() {
  'use strict';

  function onDOMReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  function setupIndex() {
    const articleBody = document.querySelector('.article-body');
    if (!articleBody) return;

    const indexHeading = [...articleBody.querySelectorAll('h3')]
      .find((heading) => heading.textContent.trim().toLowerCase() === 'index');

    if (!indexHeading) return;

    const indexList = indexHeading.nextElementSibling;
    if (!indexList || indexList.tagName !== 'UL') return;

    indexList.classList.add('article-index');

    const links = [...indexList.querySelectorAll('a[href^="#"]')]
      .filter((link) => link.getAttribute('href').length > 1);

    if (!links.length) return;

    const sections = links
      .map((link) => {
        const id = decodeURIComponent(link.getAttribute('href').slice(1));
        const section = document.getElementById(id);

        if (!section) return null;

        return { link, section };
      })
      .filter(Boolean);

    if (!sections.length) return;

    sections.forEach(({ link }) => {
      const item = link.closest('li');
      if (item) item.classList.add('index-item');
    });

    function setActiveSection(activeSection) {
      sections.forEach(({ link, section }) => {
        const item = link.closest('li');
        const isActive = section === activeSection;

        link.classList.toggle('is-active', isActive);

        if (item) {
          item.classList.toggle('is-active', isActive);
        }

        if (isActive) {
          link.setAttribute('aria-current', 'location');
        } else {
          link.removeAttribute('aria-current');
        }
      });
    }

    function getScrollOffset() {
      const header = document.querySelector('.bp-header');
      const headerHeight = header ? header.getBoundingClientRect().height : 0;

      return headerHeight + 24;
    }

    function scrollToSection(event) {
      const link = event.currentTarget;
      const href = link.getAttribute('href');
      if (!href || href === '#') return;

      const id = decodeURIComponent(href.slice(1));
      const target = document.getElementById(id);
      if (!target) return;

      event.preventDefault();

      const targetTop =
        target.getBoundingClientRect().top +
        window.scrollY -
        getScrollOffset();

      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth'
      });

      if (history.replaceState) {
        history.replaceState(null, '', `#${encodeURIComponent(id)}`);
      }

      setActiveSection(target);
    }

    sections.forEach(({ link }) => {
      link.addEventListener('click', scrollToSection);
    });

    let ticking = false;

    function updateActiveSection() {
      ticking = false;

      const readingLine = window.scrollY + getScrollOffset() + 8;
      let active = sections[0].section;

      sections.forEach(({ section }) => {
        if (section.offsetTop <= readingLine) {
          active = section;
        }
      });

      setActiveSection(active);
    }

    function requestActiveUpdate() {
      if (ticking) return;

      ticking = true;
      window.requestAnimationFrame(updateActiveSection);
    }

    window.addEventListener('scroll', requestActiveUpdate, { passive: true });
    window.addEventListener('resize', requestActiveUpdate, { passive: true });

    if (window.location.hash) {
      const initialId = decodeURIComponent(window.location.hash.slice(1));
      const initialSection = document.getElementById(initialId);

      if (initialSection) {
        setActiveSection(initialSection);
      }
    } else {
      updateActiveSection();
    }
  }

  onDOMReady(setupIndex);
})();
