// fx.js — синтетические звуки (Web Audio API) + confetti overlay
(function () {
  let actx = null;
  function ensureAudio() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { actx = null; }
    }
    if (actx && actx.state === "suspended") actx.resume();
    return actx;
  }

  function beep(freqStart, freqEnd, durationMs, type = "sine", gain = 0.06) {
    const a = ensureAudio(); if (!a) return;
    const now = a.currentTime;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + durationMs / 1000);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.connect(g).connect(a.destination);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.02);
  }

  function chord(freqs, durationMs, gain = 0.05) {
    freqs.forEach((f, i) => setTimeout(() => beep(f, f, durationMs, "triangle", gain), i * 60));
  }

  window.FX = {
    enabled: true,
    setEnabled(v) { this.enabled = !!v; if (v) ensureAudio(); },
    hit() { if (this.enabled) beep(540, 780, 70, "sine", 0.05); },
    miss() { if (this.enabled) beep(220, 110, 160, "square", 0.05); },
    milestone(level) {
      if (!this.enabled) return;
      if (level === "small") beep(660, 990, 110, "triangle", 0.06);
      else if (level === "med") chord([660, 880], 140, 0.05);
      else chord([523, 659, 784, 1047], 180, 0.06);
    },
    finish() {
      if (!this.enabled) return;
      chord([523, 659, 784, 1047, 1319], 220, 0.07);
    },
    select() { if (this.enabled) beep(880, 880, 35, "sine", 0.03); },
  };

  // ---- confetti ----
  function makeConfetti(parentEl) {
    const c = document.createElement("canvas");
    c.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:200";
    parentEl.appendChild(c);
    const ctx = c.getContext("2d");
    function resize() { c.width = innerWidth; c.height = innerHeight; }
    resize();
    window.addEventListener("resize", resize);

    const colors = ["#ff5b6c", "#5b6cff", "#ffd166", "#06d6a0", "#b16cff", "#ffffff", "#ff7a00"];
    const particles = [];
    const N = 180;
    for (let i = 0; i < N; i++) {
      particles.push({
        x: c.width / 2 + (Math.random() - 0.5) * 80,
        y: c.height / 2,
        vx: (Math.random() - 0.5) * 14,
        vy: -Math.random() * 14 - 4,
        size: 4 + Math.random() * 6,
        color: colors[(Math.random() * colors.length) | 0],
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 0.3,
        life: 1,
      });
    }

    function frame() {
      ctx.clearRect(0, 0, c.width, c.height);
      let alive = 0;
      for (const p of particles) {
        p.vy += 0.35;     // gravity
        p.vx *= 0.995;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        p.life -= 0.006;
        if (p.life > 0 && p.y < c.height + 40) {
          alive++;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx.restore();
        }
      }
      if (alive > 0) requestAnimationFrame(frame);
      else c.remove();
    }
    requestAnimationFrame(frame);
  }
  window.FX.confetti = (parent) => makeConfetti(parent || document.body);
})();
