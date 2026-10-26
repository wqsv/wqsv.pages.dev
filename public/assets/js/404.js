
(() => {
  "use strict";

  const init = () => {
    const button = document.querySelector(".where-button");
    const screen = document.querySelector(".where-screen");

    if (!button || !screen) return;

    const EDGE = 10;
    const SMOOTHNESS = 0.22;
    const RETURN_DELAY = 2000;

    let following = false;
    let hasClicked = false;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let raf = 0;
    let returnTimer = 0;

    const pointerTarget = ({ clientX, clientY }) => {
      const { width, height } = button.getBoundingClientRect();
      const maxX = Math.max(EDGE, innerWidth - width - EDGE);
      const maxY = Math.max(EDGE, innerHeight - height - EDGE);

      targetX = Math.min(Math.max(EDGE, clientX - width / 2), maxX);
      targetY = Math.min(Math.max(EDGE, clientY - height / 2), maxY);
    };

    const animate = () => {
      if (!following || hasClicked) {
        raf = 0;
        return;
      }

      currentX += (targetX - currentX) * SMOOTHNESS;
      currentY += (targetY - currentY) * SMOOTHNESS;

      if (Math.abs(targetX - currentX) < 0.4) currentX = targetX;
      if (Math.abs(targetY - currentY) < 0.4) currentY = targetY;

      button.style.left = `${currentX}px`;
      button.style.top = `${currentY}px`;
      button.style.right = "auto";
      button.style.bottom = "auto";

      raf = requestAnimationFrame(animate);
    };

    const startFollowing = (event) => {
      if (event.pointerType === "touch" || hasClicked) return;

      const { left, top } = button.getBoundingClientRect();
      currentX = left;
      currentY = top;

      pointerTarget(event);
      following = true;

      if (!raf) raf = requestAnimationFrame(animate);
    };

    const trackPointer = (event) => {
      if (following && event.pointerType !== "touch" && !hasClicked) {
        pointerTarget(event);
      }
    };

    const handleResize = () => {
      if (!following || hasClicked) return;

      const maxX = Math.max(EDGE, innerWidth - button.offsetWidth - EDGE);
      const maxY = Math.max(EDGE, innerHeight - button.offsetHeight - EDGE);

      targetX = Math.min(targetX, maxX);
      targetY = Math.min(targetY, maxY);
    };

    const showWhere = () => {
      if (hasClicked) return;

      hasClicked = true;
      following = false;

      if (raf) cancelAnimationFrame(raf);
      raf = 0;

      button.hidden = true;
      document.body.classList.add("is-where");
      screen.setAttribute("aria-hidden", "false");

      const heading = screen.querySelector(".where-screen__word");

      heading?.setAttribute("role", "heading");
      heading?.setAttribute("aria-level", "1");

      document.title = "WHERE?";

      clearTimeout(returnTimer);

      returnTimer = setTimeout(() => {
        document.body.classList.remove("is-where");
        document.body.classList.add("has-used-where");
        screen.setAttribute("aria-hidden", "true");
        document.title = "ಠ_ಠ";
      }, RETURN_DELAY);
    };

    button.addEventListener("pointerenter", startFollowing);
    button.addEventListener("click", showWhere);
    window.addEventListener("pointermove", trackPointer, { passive: true });
    window.addEventListener("resize", handleResize);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
