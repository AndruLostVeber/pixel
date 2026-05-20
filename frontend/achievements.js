// achievements.js — простые ачивки в localStorage, тост при разблокировке
(function () {
  const KEY = "pixelforge:achievements";
  const STATS_KEY = "pixelforge:stats";

  const LIST = [
    { id: "first_paint",  icon: "🎨", name: "Первая клетка",        desc: "Закрашен первый пиксель" },
    { id: "first_finish", icon: "🏁", name: "Готово!",              desc: "Закончил первую раскраску" },
    { id: "perfect",      icon: "💯", name: "Идеально",             desc: "Закончил без единой ошибки" },
    { id: "speedrun",     icon: "⚡", name: "Спидран",              desc: "Закончил быстрее чем за 90 секунд" },
    { id: "mega_streak",  icon: "🔥", name: "Мега-стрик",           desc: "50 правильных подряд" },
    { id: "ultra_streak", icon: "🌟", name: "Ультра-стрик",         desc: "100 правильных подряд" },
    { id: "ten_finishes", icon: "🖼️", name: "Коллекционер",         desc: "Закончил 10 раскрасок" },
    { id: "explorer",     icon: "🧭", name: "Исследователь",        desc: "Использовал 5 разных бэкендов/промптов" },
    { id: "big_grid",     icon: "🧱", name: "Большая стройка",      desc: "Закончил 64+ грид" },
    { id: "no_hints",     icon: "🤓", name: "Без подсказок",        desc: "Закончил без кнопок hint/autofill" },
  ];

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function save(obj) {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (_) {}
  }
  function getStats() {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      return raw ? JSON.parse(raw) : { finishes: 0, prompts: new Set(), usedHint: false };
    } catch (_) { return { finishes: 0, prompts: [], usedHint: false }; }
  }
  function saveStats(s) {
    try {
      const flat = { ...s, prompts: Array.isArray(s.prompts) ? s.prompts : [...s.prompts] };
      localStorage.setItem(STATS_KEY, JSON.stringify(flat));
    } catch (_) {}
  }

  function unlock(id) {
    const owned = load();
    if (owned[id]) return;
    const ach = LIST.find((a) => a.id === id);
    if (!ach) return;
    owned[id] = Date.now();
    save(owned);
    showUnlockToast(ach);
  }

  function showUnlockToast(ach) {
    if (!window.FX) return;
    const root = document.getElementById("toast-root") || (() => {
      const r = document.createElement("div");
      r.id = "toast-root";
      r.style.cssText = "position:fixed;top:18px;right:18px;display:flex;flex-direction:column;gap:8px;z-index:300;pointer-events:none;";
      document.body.appendChild(r);
      return r;
    })();
    const t = document.createElement("div");
    t.className = "ach-toast";
    t.innerHTML = `
      <div class="ach-icon">${ach.icon}</div>
      <div class="ach-text">
        <div class="ach-name">🏆 ${ach.name}</div>
        <div class="ach-desc">${ach.desc}</div>
      </div>`;
    root.appendChild(t);
    requestAnimationFrame(() => t.classList.add("ach-show"));
    setTimeout(() => {
      t.classList.remove("ach-show");
      setTimeout(() => t.remove(), 400);
    }, 4200);
    window.FX.milestone("big");
  }

  window.Achievements = {
    LIST,
    owned: load,
    unlock,
    stats: getStats,
    saveStats,
    incrementFinishes() {
      const s = getStats();
      s.finishes = (s.finishes || 0) + 1;
      if (!Array.isArray(s.prompts)) s.prompts = [];
      saveStats(s);
      if (s.finishes >= 1) unlock("first_finish");
      if (s.finishes >= 10) unlock("ten_finishes");
    },
    notePrompt(prompt) {
      const s = getStats();
      if (!Array.isArray(s.prompts)) s.prompts = [];
      if (prompt && !s.prompts.includes(prompt)) s.prompts.push(prompt);
      saveStats(s);
      if (s.prompts.length >= 5) unlock("explorer");
    },
    noteHintUsed() {
      const s = getStats();
      s.usedHint = true;
      saveStats(s);
    },
    resetHintFlag() {
      const s = getStats();
      s.usedHint = false;
      saveStats(s);
    },
    wasHintUsed() {
      return !!getStats().usedHint;
    },
  };
})();
