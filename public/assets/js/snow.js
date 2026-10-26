
(() => {
    "use strict";

    // =========================================================
    // secret name popup
    // =========================================================

    const trigger = document.getElementById("secretName");
    const modal = document.getElementById("secretModal");
    const closeButton = document.getElementById("closeModal");
    const okButton = document.getElementById("modalOk");

    if (trigger && modal && closeButton && okButton) {
        function closeModal() {
            modal.hidden = true;
            document.body.classList.remove("modal-open");
            trigger.focus();
        }

        function openModal() {
            modal.hidden = false;
            document.body.classList.add("modal-open");
            closeButton.focus();
        }

        trigger.addEventListener("click", openModal);
        closeButton.addEventListener("click", closeModal);
        okButton.addEventListener("click", closeModal);

        modal.addEventListener("click", event => {
            if (event.target === modal) {
                closeModal();
            }
        });

        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && !modal.hidden) {
                closeModal();
            }
        });
    }

    // =========================================================
    // dynamic footer pattern
    // =========================================================

    const footer = document.getElementById("footerPattern");

    if (footer) {
        const measureCanvas = document.createElement("canvas");
        const measureContext = measureCanvas.getContext("2d");

        function fitFooter() {
            if (!measureContext) {
                footer.textContent = "ђ".repeat(100);
                return;
            }

            const style = getComputedStyle(footer);
            measureContext.font = style.font;

            const characterWidth = measureContext.measureText("ђ").width + (parseFloat(style.letterSpacing) || 0);

            if (!characterWidth || !footer.clientWidth) {
                return;
            }

            const count = Math.ceil(
                footer.clientWidth / characterWidth
            ) + 2;

            footer.textContent = "ђ".repeat(count);
        }

        if ("ResizeObserver" in window) {
            new ResizeObserver(fitFooter).observe(footer);
        }

        window.addEventListener("resize", fitFooter);
        window.addEventListener("load", fitFooter);

        fitFooter();

        if (document.fonts?.ready) {
            document.fonts.ready.then(fitFooter);
        }
    }

    // =========================================================
    // snow animation
    // =========================================================

    const canvas = document.getElementById("snowCanvas");
    const ctx = canvas?.getContext("2d");

    if (!canvas || !ctx) {
        return;
    }

    const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    );

    const TAU = Math.PI * 2;
    const random = (min, max) => Math.random() * (max - min) + min;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    let width = 0;
    let height = 0;
    let dpr = 1;
    let lastTime = 0;
    let elapsed = 0;
    let animationId = 0;
    let flakes = [];

    function createFlake(initial = false) {
        const depth = Math.random();

        return {
            x: random(-20, width + 20),
            y: initial ? random(-20, height + 20) : random(-60, -5),

            radius: 0.55 + depth * 2.15,
            opacity: 0.25 + depth * 0.65,
            speed: 35 + depth * 115,
            sway: random(0.5, 2.2),
            phase: random(0, TAU),
            streak: depth > 0.72 ? random(2, 6) : 0
        };
    }

    function createSnow() {
        const area = width * height;
        const count = clamp(Math.round(area / 1800), 180, 750);

        flakes = Array.from(
            { length: count },
            () => createFlake(true)
        );
    }

    function resizeCanvas() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = window.innerWidth;
        height = window.innerHeight;

        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        createSnow();
        render(elapsed, 0);
    }

    function drawSnow(dt, time) {
        const wind =
            85 +
            Math.sin(time * 0.00025) * 35 +
            Math.sin(time * 0.0011) * 55 +
            Math.sin(time * 0.00043) * 25;

        ctx.fillStyle = "#f3f7ff";

        for (let i = 0; i < flakes.length; i++) {
            const flake = flakes[i];

            flake.phase += dt * flake.sway;

            flake.x += (
                wind * (0.35 + flake.radius * 0.35) +
                Math.sin(flake.phase) * 12
            ) * dt;

            flake.y += flake.speed * dt;

            if (flake.x > width + 12) {
                flake.x = -12;
            } else if (flake.x < -12) {
                flake.x = width + 12;
            }

            if (flake.y > height + 10) {
                flakes[i] = createFlake();
                continue;
            }

            ctx.globalAlpha = flake.opacity;
            ctx.beginPath();

            if (flake.streak > 0) {
                ctx.ellipse(
                    flake.x,
                    flake.y,
                    flake.radius * 0.7 + flake.streak * 0.15,
                    flake.radius + flake.streak * 0.25,
                    -0.25,
                    0,
                    TAU
                );
            } else {
                ctx.arc(
                    flake.x,
                    flake.y,
                    flake.radius,
                    0,
                    TAU
                );
            }

            ctx.fill();
        }

        ctx.globalAlpha = 1;
    }

    function render(time, dt) {
        ctx.clearRect(0, 0, width, height);
        drawSnow(dt, time);
    }

    function animate(timestamp) {
        if (document.hidden) {
            animationId = 0;
            lastTime = 0;
            return;
        }

        const dt = lastTime ? Math.min((timestamp - lastTime) / 1000, 0.04) : 0;

        lastTime = timestamp;
        elapsed += dt * 1000;

        render(elapsed, dt);
        animationId = requestAnimationFrame(animate);
    }

    function startAnimation() {
        if (reducedMotion.matches || document.hidden) {
            render(elapsed, 0);
            return;
        }

        if (!animationId) {
            lastTime = 0;
            animationId = requestAnimationFrame(animate);
        }
    }

    function stopAnimation() {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = 0;
        }

        lastTime = 0;
    }

    window.addEventListener("resize", resizeCanvas, {
        passive: true
    });

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            stopAnimation();
        } else {
            startAnimation();
        }
    });

    reducedMotion.addEventListener?.("change", () => {
        stopAnimation();
        startAnimation();
    });

    resizeCanvas();
    startAnimation();
})();
