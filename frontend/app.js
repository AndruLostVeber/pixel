// PixelForge — Paint by Numbers client
const $ = (id) => document.getElementById(id);

const CANVAS_PX = 768;
const canvas = $("canvas");
const ctx = canvas.getContext("2d");

const state = {
  gridSize: 0,
  cellPx: 0,
  palette: [],          // ["#aabbcc", ...]
  indices: [],          // 2D [y][x] -> palette index
  filled: [],           // 2D [y][x] -> bool
  selectedColor: null,  // palette index or null
  errors: 0,
  totalCells: 0,
  filledCells: 0,
  hintCellsToRedraw: new Set(),
  previewB64: null,
  startedAt: null,
  hoverCell: null,             // {x,y} текущая клетка под курсором
  // tool
  tool: "brush",               // "brush" | "bucket" | "eraser"
  // combo / pulse
  streak: 0,
  bestStreak: 0,
  pulses: [],  // [{x,y,t0,color}], затухающая подсветка только что закрашенных
};

/* ---------- rendering ---------- */

function clearCanvas() {
  ctx.fillStyle = "#f7f7f0";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawGrid() {
  const { gridSize, cellPx } = state;
  ctx.strokeStyle = "#d8d6c8";
  ctx.lineWidth = Math.max(1, cellPx / 24);   // толщина линий растёт с буфером, остаётся видимой на CSS-px
  const total = gridSize * cellPx;
  for (let i = 0; i <= gridSize; i++) {
    const p = Math.round(i * cellPx) + 0.5;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, total); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(total, p); ctx.stroke();
  }
}

function drawNumbers() {
  const { gridSize, cellPx, indices, filled } = state;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.max(8, Math.floor(cellPx * 0.45))}px JetBrains Mono, Consolas, monospace`;
  ctx.fillStyle = "#3a3a3a";
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (filled[y][x]) continue;
      const num = indices[y][x] + 1;
      const cx = x * cellPx + cellPx / 2;
      const cy = y * cellPx + cellPx / 2;
      ctx.fillText(String(num), cx, cy);
    }
  }
}

function drawFilledCells() {
  const { gridSize, cellPx, indices, filled, palette } = state;
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (!filled[y][x]) continue;
      ctx.fillStyle = palette[indices[y][x]];
      ctx.fillRect(x * cellPx, y * cellPx, cellPx + 0.5, cellPx + 0.5);
    }
  }
}

function repaint() {
  clearCanvas();
  drawFilledCells();
  drawGrid();
  drawNumbers();
}

const PULSE_MS = 450;
function drawPulses() {
  if (!state.pulses.length) return;
  const now = performance.now();
  const { cellPx } = state;
  let alive = [];
  for (const p of state.pulses) {
    const t = (now - p.t0) / PULSE_MS;
    if (t >= 1) continue;
    alive.push(p);
    const ease = 1 - Math.pow(1 - t, 3);     // ease-out cubic
    const grow = cellPx * 0.55 * (1 - ease);
    ctx.save();
    ctx.globalAlpha = (1 - ease) * 0.85;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(
      p.x * cellPx - grow / 2,
      p.y * cellPx - grow / 2,
      cellPx + grow,
      cellPx + grow,
    );
    ctx.restore();
  }
  state.pulses = alive;
}

function drawHover() {
  const h = state.hoverCell;
  if (!h || state.selectedColor == null) return;
  if (state.filled[h.y][h.x]) return;
  const { cellPx } = state;
  const right = state.indices[h.y][h.x] === state.selectedColor;
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = right ? state.palette[state.selectedColor] : "#ff5b6c";
  ctx.fillRect(h.x * cellPx, h.y * cellPx, cellPx, cellPx);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.strokeStyle = right ? state.palette[state.selectedColor] : "#ff5b6c";
  ctx.strokeRect(h.x * cellPx + 1, h.y * cellPx + 1, cellPx - 2, cellPx - 2);
  ctx.restore();
}

let animLoopRunning = false;
function animLoop() {
  if (state.pulses.length || state.hoverCell) {
    drawFilledCells();
    drawPulses();
    drawGrid();
    drawNumbers();
    drawHover();
    requestAnimationFrame(animLoop);
  } else {
    animLoopRunning = false;
  }
}
function kickAnim() {
  if (!animLoopRunning) {
    animLoopRunning = true;
    requestAnimationFrame(animLoop);
  }
}

function flashCell(x, y, color, durationMs) {
  const { cellPx } = state;
  ctx.fillStyle = color;
  ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
  setTimeout(() => repaint(), durationMs);
}

/* ---------- palette ---------- */

function buildPalette() {
  const pal = $("palette");
  pal.innerHTML = "";
  state.palette.forEach((hex, i) => {
    const cell = document.createElement("div");
    cell.className = "palette-cell";
    cell.style.background = hex;
    cell.dataset.idx = i;
    cell.innerHTML = `<span class="num">${i + 1}</span><span class="remaining" data-rem="${i}"></span>`;
    cell.addEventListener("click", () => selectColor(i));
    pal.appendChild(cell);
  });
  updateRemaining();
}

function updateRemaining() {
  const remaining = state.palette.map(() => 0);
  for (let y = 0; y < state.gridSize; y++) {
    for (let x = 0; x < state.gridSize; x++) {
      if (!state.filled[y][x]) remaining[state.indices[y][x]]++;
    }
  }
  document.querySelectorAll(".palette-cell").forEach((cell) => {
    const i = +cell.dataset.idx;
    const rem = remaining[i];
    cell.querySelector(".remaining").textContent = rem > 0 ? rem : "✓";
    cell.classList.toggle("done", rem === 0);
  });
}

function selectColor(i) {
  state.selectedColor = i;
  document.querySelectorAll(".palette-cell").forEach((c) => {
    c.classList.toggle("selected", +c.dataset.idx === i);
  });
  const hintsOk = state.hintsAllowed !== false;
  $("hint-btn").disabled = !hintsOk;
  window.FX && FX.select();
}

/* ---------- interactions ---------- */

function cellFromEvent(ev) {
  if (!state.gridSize) return null;
  const rect = canvas.getBoundingClientRect();
  const cssCell = rect.width / state.gridSize;
  if (cssCell <= 0) return null;
  const x = Math.floor((ev.clientX - rect.left) / cssCell);
  const y = Math.floor((ev.clientY - rect.top) / cssCell);
  if (x < 0 || y < 0 || x >= state.gridSize || y >= state.gridSize) return null;
  return { x, y };
}

function paintCell(x, y) {
  if (state.filled[y][x]) return "skip";
  if (state.indices[y][x] === state.selectedColor) {
    state.filled[y][x] = true;
    state.filledCells++;
    ctx.fillStyle = state.palette[state.selectedColor];
    ctx.fillRect(x * state.cellPx, y * state.cellPx, state.cellPx + 0.5, state.cellPx + 0.5);
    state.pulses.push({ x, y, t0: performance.now(), color: state.palette[state.selectedColor] });
    kickAnim();
    const prevStreak = state.streak;
    state.streak++;
    if (state.streak > state.bestStreak) state.bestStreak = state.streak;
    updateStreak();
    window.FX && FX.hit();
    if (state.streak === 5 || state.streak === 10 || state.streak === 25 || state.streak === 50) {
      const level = state.streak >= 25 ? "big" : state.streak >= 10 ? "med" : "small";
      window.FX && FX.milestone(level);
    }
    if (state.filledCells === 1) window.Achievements && Achievements.unlock("first_paint");
    if (state.streak === 50) window.Achievements && Achievements.unlock("mega_streak");
    if (state.streak === 100) window.Achievements && Achievements.unlock("ultra_streak");
    scheduleSave();
    return "hit";
  }
  return "miss";
}

function breakStreak() {
  state.streak = 0;
  updateStreak();
}

function updateStreak() {
  const el = $("streak-count");
  if (!el) return;
  el.textContent = state.streak;
  el.classList.remove("streak-flame", "streak-blaze", "streak-mega");
  if (state.streak >= 25) el.classList.add("streak-mega");
  else if (state.streak >= 10) el.classList.add("streak-blaze");
  else if (state.streak >= 5) el.classList.add("streak-flame");
  const best = $("best-streak");
  if (best) best.textContent = state.bestStreak;
}

function applyHit() {
  drawGrid();
  updateProgress();
  updateRemaining();
  if (state.filledCells === state.totalCells) onFinish();
}

function doBrushClick(x, y) {
  // одиночный клик кистью — с штрафом за промах
  const res = paintCell(x, y);
  if (res === "hit") applyHit();
  else if (res === "miss") {
    state.errors++;
    $("errors-count").textContent = state.errors;
    breakStreak();
    window.FX && FX.miss();
    flashCell(x, y, "rgba(255,80,80,0.85)", 220);
  }
}

function doEraser(x, y) {
  if (!state.filled[y][x]) return;
  state.filled[y][x] = false;
  state.filledCells--;
  updateProgress();
  updateRemaining();
  repaint();
  scheduleSave();
}

function doBucket(x, y) {
  // Flood-fill BFS только по связной области с тем же индексом цвета
  if (state.selectedColor == null) {
    FX.toast("Сначала выбери цвет в палитре", { kind: "warn" });
    return;
  }
  if (state.filled[y][x]) return;
  const target = state.indices[y][x];
  if (target !== state.selectedColor) {
    // промах — клетка не нужного цвета
    state.errors++;
    $("errors-count").textContent = state.errors;
    breakStreak();
    window.FX && FX.miss();
    flashCell(x, y, "rgba(255,80,80,0.85)", 220);
    return;
  }
  const N = state.gridSize;
  const stack = [[x, y]];
  let painted = 0;
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
    if (state.filled[cy][cx]) continue;
    if (state.indices[cy][cx] !== target) continue;
    state.filled[cy][cx] = true;
    state.filledCells++;
    state.pulses.push({ x: cx, y: cy, t0: performance.now() + (painted * 4) });
    painted++;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  if (painted) {
    state.streak += painted;
    if (state.streak > state.bestStreak) state.bestStreak = state.streak;
    updateStreak();
    window.FX && FX.hit();
    if (painted >= 5) window.FX && FX.milestone("med");
    window.Achievements && Achievements.noteHintUsed();   // bucket — лёгкий чит, фиксируем
    kickAnim();
    applyHit();
    scheduleSave();
  }
}

function handleMouseDown(ev) {
  if (ev.button !== 0 && ev.button !== -1) return;
  const cell = cellFromEvent(ev);
  if (!cell) return;
  if (state.tool === "eraser") { doEraser(cell.x, cell.y); return; }
  if (state.tool === "bucket") { doBucket(cell.x, cell.y); return; }
  // brush — только один клик, никакого drag
  if (state.selectedColor == null) return;
  doBrushClick(cell.x, cell.y);
}

function handleMouseMove(ev) {
  // только обновляем hover-индикатор, никакого закрашивания
  const cell = cellFromEvent(ev);
  const prev = state.hoverCell;
  state.hoverCell = cell;
  if (!prev || !cell || prev.x !== cell.x || prev.y !== cell.y) kickAnim();
}

function handleMouseUp() { /* no-op — drag не используется */ }

function handleMouseLeave() {
  state.hoverCell = null;
  repaint();
}

function handleHint() {
  if (state.selectedColor == null) return;
  window.Achievements && Achievements.noteHintUsed();
  const { gridSize, cellPx, indices, filled, selectedColor } = state;
  ctx.save();
  ctx.fillStyle = "rgba(91,108,255,0.45)";
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (!filled[y][x] && indices[y][x] === selectedColor) {
        ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
      }
    }
  }
  ctx.restore();
  setTimeout(() => repaint(), 600);
}

function handlePreview() {
  if (!state.previewB64) return;
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, CANVAS_PX, CANVAS_PX);
    setTimeout(() => repaint(), 1500);
  };
  img.src = "data:image/webp;base64," + state.previewB64;
}

function handleReset() {
  if (!confirm("Точно сбросить всю раскраску?")) return;
  startTimer();
  FX.toast("Раскраска сброшена", { kind: "info" });
  state.filled = state.indices.map((row) => row.map(() => false));
  state.filledCells = 0;
  state.errors = 0;
  state.streak = 0;
  state.pulses = [];
  $("errors-count").textContent = 0;
  state.startedAt = performance.now();
  updateStreak();
  updateProgress();
  updateRemaining();
  repaint();
  scheduleSave();
}

function updateProgress() {
  $("filled-count").textContent = state.filledCells;
  $("total-count").textContent = state.totalCells;
  const pct = (state.filledCells / state.totalCells) * 100;
  $("progress-fill").style.width = pct.toFixed(1) + "%";
}

/* ---------- live timer ---------- */
let timerHandle = null;
function startTimer() {
  stopTimer();
  state.startedAt = performance.now();
  $("timer").textContent = "0:00";
  timerHandle = setInterval(() => {
    if (!state.startedAt) return;
    const sec = Math.floor((performance.now() - state.startedAt) / 1000);
    const mm = Math.floor(sec / 60), ss = sec % 60;
    $("timer").textContent = `${mm}:${String(ss).padStart(2, "0")}`;
  }, 1000);
}
function stopTimer() {
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
}

/* ---------- download рагулированной картинки ---------- */
function downloadPainted() {
  if (!state.gridSize) return;
  // рисуем в offscreen canvas: только закрашенные клетки на белом фоне
  const off = document.createElement("canvas");
  off.width = state.gridSize;
  off.height = state.gridSize;
  const octx = off.getContext("2d");
  octx.fillStyle = "#f7f7f0";
  octx.fillRect(0, 0, off.width, off.height);
  for (let y = 0; y < state.gridSize; y++) {
    for (let x = 0; x < state.gridSize; x++) {
      if (state.filled[y][x]) {
        octx.fillStyle = state.palette[state.indices[y][x]];
        octx.fillRect(x, y, 1, 1);
      }
    }
  }
  // апскейл x16 nearest
  const big = document.createElement("canvas");
  const SCALE = 16;
  big.width = state.gridSize * SCALE;
  big.height = state.gridSize * SCALE;
  const bctx = big.getContext("2d");
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(off, 0, 0, big.width, big.height);
  big.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pixelforge_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
    FX.toast("PNG сохранён", { kind: "success" });
  }, "image/png");
}

function onFinish() {
  stopTimer();
  const ms = performance.now() - state.startedAt;
  const sec = Math.round(ms / 1000);
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  $("finish-time").textContent = `${mm}:${String(ss).padStart(2, "0")}`;
  $("finish-errors").textContent = state.errors;
  if (state.previewB64) $("finish-preview").src = "data:image/webp;base64," + state.previewB64;
  $("finish-modal").classList.remove("hidden");
  window.FX && FX.finish();
  window.FX && FX.confetti();
  if (window.Achievements) {
    Achievements.incrementFinishes();
    if (state.errors === 0) Achievements.unlock("perfect");
    if (sec < 90) Achievements.unlock("speedrun");
    if (state.gridSize >= 64) Achievements.unlock("big_grid");
    if (!Achievements.wasHintUsed()) Achievements.unlock("no_hints");
    Achievements.resetHintFlag();
  }
}

/* ---------- generation ---------- */

async function generate() {
  const prompt = $("prompt").value.trim();
  if (!prompt) { FX.toast("Введи промпт", { kind: "warn" }); return; }
  const grid_size = +$("grid_size").value;
  const n_colors = +$("n_colors").value;
  const backend = $("backend").value;

  const statusText = backend === "local"
    ? "🎨 Local SDXL... первый раз долго (грузим в VRAM)"
    : backend === "flux-dev"
      ? "🎨 FLUX.1-dev рисует... ~10-30 сек"
      : "🎨 FLUX.1-schnell рисует... ~5 сек";
  $("status-text").textContent = statusText;
  $("status").classList.remove("hidden");
  $("generate-btn").disabled = true;

  try {
    const r = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, backend, grid_size, n_colors }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || "Generation failed");
    }
    const data = await r.json();
    loadResult(data);
    FX.toast(`Готово за ${data.elapsed_sec}с · ${data.backend} · ${data.palette.length} цветов`, { kind: "success" });
    window.Achievements && Achievements.notePrompt(prompt);
    saveHistoryPrompt(prompt);
  } catch (e) {
    FX.toast("Ошибка: " + e.message, { kind: "error", duration: 6000 });
  } finally {
    $("status").classList.add("hidden");
    $("generate-btn").disabled = false;
  }
}

function loadResult(data) {
  state.gridSize = data.grid_size;
  state.palette = data.palette;
  state.indices = data.indices;
  state.filled = data.indices.map((row) => row.map(() => false));
  state.selectedColor = null;
  state.errors = 0;
  state.filledCells = 0;
  state.totalCells = data.grid_size * data.grid_size;
  state.previewB64 = data.preview_b64;
  state.startedAt = performance.now();
  state.streak = 0;
  state.pulses = [];
  updateStreak();
  startTimer();

  $("errors-count").textContent = 0;
  $("preview-btn").disabled = false;
  $("reset-btn").disabled = false;
  $("download-btn").disabled = false;
  // блокируем хинт пока цвет не выбран
  $("hint-btn").disabled = true;

  buildPalette();
  applyZoom();   // пересчитываем буфер canvas под новый gridSize
  updateProgress();
  repaint();
  scheduleSave();
}

/* ---------- init ---------- */

/* ---------- prompt history ---------- */
const HIST_KEY = "pixelforge:promptHistory";
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); } catch (_) { return []; }
}
function saveHistoryPrompt(prompt) {
  if (!prompt) return;
  let h = loadHistory();
  h = h.filter((p) => p !== prompt);
  h.unshift(prompt);
  h = h.slice(0, 20);
  try { localStorage.setItem(HIST_KEY, JSON.stringify(h)); } catch (_) {}
  refreshHistoryDatalist();
}
function refreshHistoryDatalist() {
  const dl = $("prompt-history");
  if (!dl) return;
  dl.innerHTML = "";
  loadHistory().forEach((p) => {
    const o = document.createElement("option");
    o.value = p;
    dl.appendChild(o);
  });
}
refreshHistoryDatalist();

/* ---------- onboarding (один раз) ---------- */
function maybeOnboard() {
  try {
    if (localStorage.getItem("pixelforge:onboarded") === "1") return;
  } catch (_) {}
  setTimeout(() => {
    FX.toast("👋 Введи промпт или жми 🎲 для случайного. Закрашивай по номерам, держи ЛКМ для drag.", { kind: "info", duration: 8000 });
    setTimeout(() => FX.toast("Клавиши: G — генерация, R — сброс, 1-9 — цвета, ?/H — справка", { kind: "info", duration: 7000 }), 1100);
    try { localStorage.setItem("pixelforge:onboarded", "1"); } catch (_) {}
  }, 600);
}
maybeOnboard();

/* ---------- health ping ---------- */
let healthFails = 0;
async function pingHealth() {
  try {
    const r = await fetch("/api/health", { method: "GET", cache: "no-store" });
    if (r.ok) { healthFails = 0; document.body.classList.remove("offline"); return; }
    throw new Error();
  } catch (_) {
    healthFails++;
    if (healthFails === 2) {
      document.body.classList.add("offline");
      FX.toast("Сервер недоступен — запусти uvicorn заново", { kind: "error", duration: 6000 });
    }
  }
}
setInterval(pingHealth, 30000);

/* ---------- difficulty ---------- */
const DIFFICULTY = {
  easy:   { grid: 24, colors: 8,  hints: true,  label: "Easy" },
  normal: { grid: 32, colors: 12, hints: true,  label: "Normal" },
  hard:   { grid: 48, colors: 18, hints: false, label: "Hard" },
};
function applyDifficulty(name) {
  if (name === "custom") {
    state.hintsAllowed = true;
    return;
  }
  const d = DIFFICULTY[name];
  if (!d) return;
  $("grid_size").value = d.grid;
  $("n_colors").value = d.colors;
  state.hintsAllowed = d.hints;
  // блокируем кнопку подсказки если уровень не позволяет
  if (state.gridSize) {
    $("hint-btn").disabled = !d.hints;
  }
  try { localStorage.setItem("pixelforge:difficulty", name); } catch (_) {}
}
$("difficulty").addEventListener("change", (e) => {
  applyDifficulty(e.target.value);
  FX.toast(`Режим: ${DIFFICULTY[e.target.value]?.label || "Custom"}`, { kind: "info" });
});
try {
  const savedDiff = localStorage.getItem("pixelforge:difficulty");
  if (savedDiff) {
    $("difficulty").value = savedDiff;
    applyDifficulty(savedDiff);
  } else {
    state.hintsAllowed = true;
  }
} catch (_) { state.hintsAllowed = true; }

/* ---------- presets ---------- */
const PRESETS = [
  ["🐉", "red dragon"],
  ["⚔️", "diamond sword"],
  ["🏰", "medieval castle"],
  ["👹", "cute green slime monster"],
  ["🍄", "magic mushroom"],
  ["💎", "blue gem stone"],
  ["🌳", "ancient oak tree"],
  ["🎃", "halloween pumpkin"],
  ["🧙", "wise wizard with staff"],
  ["🐱", "fluffy orange cat"],
  ["🤖", "retro robot"],
  ["🚀", "rocket ship"],
  ["🐟", "rainbow tropical fish"],
  ["🌺", "tropical flower"],
  ["⚓", "anchor with rope"],
  ["🍕", "pizza slice"],
  ["🍔", "burger"],
  ["☕", "coffee cup"],
  ["🦄", "magical unicorn"],
  ["🗡️", "katana sword"],
  ["🏹", "elven bow with arrow"],
  ["🛡️", "knight shield"],
  ["💀", "skull"],
  ["🍷", "wine bottle"],
  ["📦", "wooden crate"],
  ["🗝️", "old skeleton key"],
];

function buildPresets() {
  const root = $("presets");
  if (!root) return;
  PRESETS.forEach(([emoji, prompt]) => {
    const b = document.createElement("button");
    b.className = "preset-chip";
    b.type = "button";
    b.title = prompt;
    b.innerHTML = `<span class="preset-emoji">${emoji}</span><span class="preset-label">${prompt.split(",")[0]}</span>`;
    b.addEventListener("click", () => {
      $("prompt").value = prompt;
      $("prompt").focus();
      window.FX && FX.select();
    });
    root.appendChild(b);
  });
}
buildPresets();

/* ---------- zoom (внутренний буфер растёт с CSS, цифры остаются чёткими) ---------- */
const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
let zoomIdx = 2;   // 1.0
function applyZoom() {
  const z = ZOOM_LEVELS[zoomIdx];
  const cssSize = CANVAS_PX * z;
  canvas.style.width = cssSize + "px";
  canvas.style.height = cssSize + "px";
  $("zoom-reset").textContent = Math.round(z * 100) + "%";
  try { localStorage.setItem("pixelforge:zoom", String(zoomIdx)); } catch (_) {}

  if (!state.gridSize) {
    canvas.width = CANVAS_PX;
    canvas.height = CANVAS_PX;
    return;
  }
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  // внутренний буфер кратен gridSize чтобы клетки не "плыли", макс 4096 ради памяти
  let internal = Math.min(4096, Math.round(cssSize * dpr));
  internal = Math.floor(internal / state.gridSize) * state.gridSize;
  if (internal < state.gridSize) internal = state.gridSize;
  canvas.width = internal;
  canvas.height = internal;
  state.cellPx = internal / state.gridSize;
  repaint();
}
function zoomBy(delta) {
  const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, zoomIdx + delta));
  if (next === zoomIdx) return;
  zoomIdx = next;
  applyZoom();
}
$("zoom-in").addEventListener("click", () => zoomBy(1));
$("zoom-out").addEventListener("click", () => zoomBy(-1));
$("zoom-reset").addEventListener("click", () => { zoomIdx = 2; applyZoom(); });
canvas.addEventListener("wheel", (ev) => {
  if (!ev.ctrlKey && !ev.metaKey) return;
  ev.preventDefault();
  zoomBy(ev.deltaY < 0 ? 1 : -1);
}, { passive: false });
try {
  const z = parseInt(localStorage.getItem("pixelforge:zoom") || "2", 10);
  if (z >= 0 && z < ZOOM_LEVELS.length) zoomIdx = z;
} catch (_) {}
applyZoom();

/* ---------- tool switcher ---------- */
function selectTool(name) {
  state.tool = name;
  document.querySelectorAll(".tool-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === name);
  });
  // курсор-намёк
  canvas.style.cursor = name === "eraser" ? "cell" : name === "bucket" ? "crosshair" : "crosshair";
  try { localStorage.setItem("pixelforge:tool", name); } catch (_) {}
  window.FX && FX.select();
}
document.querySelectorAll(".tool-btn").forEach((b) => {
  b.addEventListener("click", () => selectTool(b.dataset.tool));
});
try {
  const savedTool = localStorage.getItem("pixelforge:tool");
  if (savedTool && ["brush", "bucket", "eraser"].includes(savedTool)) selectTool(savedTool);
} catch (_) {}

// очищаем устаревший флаг (теперь drag режим удалён совсем)
try { localStorage.removeItem("pixelforge:dragMode"); } catch (_) {}

/* ---------- pointer events: единый путь для мыши и touch ----------
 * Раньше mouse+touch дублировались — на крупных гридах одно нажатие
 * могло триггерить mousedown+touchstart. Теперь один источник истины.
 * Бонусом — pinch-zoom двумя пальцами.
 */
const activePointers = new Map();   // pointerId -> { x, y }
let pinchStartDist = 0;
let pinchStartZoomIdx = 2;
let pinchLastCenter = null;          // {x, y} для pan-сдвига

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
function centerOf(p1, p2) {
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

canvas.style.touchAction = "none";   // отключаем нативные жесты браузера

canvas.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0 && ev.button !== -1) return;  // mouse-only left btn
  canvas.setPointerCapture(ev.pointerId);
  activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

  // если два пальца — переключаемся в режим pinch и отменяем рисование
  if (activePointers.size === 2) {
    const [p1, p2] = [...activePointers.values()];
    pinchStartDist = dist(p1, p2);
    pinchStartZoomIdx = zoomIdx;
    pinchLastCenter = centerOf(p1, p2);
    state.isDragging = false;
    state.hoverCell = null;
    return;
  }
  if (activePointers.size > 1) return;

  // ровно один pointer — стандартный mouse-like flow
  handleMouseDown(ev);
}, { passive: true });

canvas.addEventListener("pointermove", (ev) => {
  if (!activePointers.has(ev.pointerId)) {
    // hover (только для mouse) — нужен индикатор клетки
    if (ev.pointerType === "mouse" && activePointers.size === 0) handleMouseMove(ev);
    return;
  }
  activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

  if (activePointers.size === 2) {
    const [p1, p2] = [...activePointers.values()];
    const d = dist(p1, p2);
    const c = centerOf(p1, p2);
    // pinch zoom
    if (pinchStartDist > 0) {
      const ratio = d / pinchStartDist;
      const targetZoom = ZOOM_LEVELS[pinchStartZoomIdx] * ratio;
      let best = 0, bestDiff = Infinity;
      for (let i = 0; i < ZOOM_LEVELS.length; i++) {
        const diff = Math.abs(ZOOM_LEVELS[i] - targetZoom);
        if (diff < bestDiff) { bestDiff = diff; best = i; }
      }
      if (best !== zoomIdx) {
        zoomIdx = best;
        applyZoom();
      }
    }
    // two-finger pan
    if (pinchLastCenter) {
      const dx = pinchLastCenter.x - c.x;
      const dy = pinchLastCenter.y - c.y;
      const wrap = $("canvas-scroll");
      if (wrap) {
        wrap.scrollLeft += dx;
        wrap.scrollTop += dy;
      }
    }
    pinchLastCenter = c;
    return;
  }
  // одно касание — рисуем как обычно
  handleMouseMove(ev);
}, { passive: true });

function endPointer(ev) {
  activePointers.delete(ev.pointerId);
  if (activePointers.size < 2) {
    pinchStartDist = 0;
    pinchLastCenter = null;
  }
  if (activePointers.size === 0) {
    handleMouseUp();
  }
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", (ev) => {
  if (ev.pointerType === "mouse") handleMouseLeave();
  // touch — не сбрасываем, может вернуться
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

/* ---------- dice (рандом промпт) ---------- */
$("dice-btn").addEventListener("click", () => {
  if (!PRESETS.length) return;
  const r = PRESETS[(Math.random() * PRESETS.length) | 0];
  $("prompt").value = r[1];
  $("prompt").focus();
  window.FX && FX.select();
});

/* ---------- download ---------- */
$("download-btn").addEventListener("click", downloadPainted);

/* ---------- trophy modal ---------- */
function openTrophy() {
  const list = $("trophy-list");
  list.innerHTML = "";
  const owned = window.Achievements ? Achievements.owned() : {};
  Achievements.LIST.forEach((a) => {
    const row = document.createElement("div");
    const got = !!owned[a.id];
    row.className = "trophy-row" + (got ? " got" : "");
    row.innerHTML = `
      <div class="trophy-icon">${got ? a.icon : "🔒"}</div>
      <div class="trophy-text">
        <div class="trophy-name">${a.name}</div>
        <div class="trophy-desc">${a.desc}</div>
      </div>`;
    list.appendChild(row);
  });
  $("trophy-modal").classList.remove("hidden");
}
$("trophy-btn").addEventListener("click", () => { closeMenu(); openTrophy(); });
$("trophy-close").addEventListener("click", () => $("trophy-modal").classList.add("hidden"));

/* ---------- bottom-sheet menu ---------- */
function openMenu() { $("menu-sheet").classList.remove("hidden"); }
function closeMenu() { $("menu-sheet").classList.add("hidden"); }
$("menu-btn").addEventListener("click", openMenu);
$("menu-close").addEventListener("click", closeMenu);
$("menu-sheet").addEventListener("click", (e) => { if (e.target.id === "menu-sheet") closeMenu(); });
// После генерации меню автоматически закрывается — пусть юзер сразу видит картинку
const _origLoadResult2 = loadResult;
loadResult = function (data) {
  _origLoadResult2(data);
  closeMenu();
};

/* ---------- keyboard shortcuts ---------- */
document.addEventListener("keydown", (e) => {
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Escape") {
    $("finish-modal").classList.add("hidden");
    $("trophy-modal").classList.add("hidden");
    closeMenu();
    return;
  }
  switch (e.key.toLowerCase()) {
    case "g": $("generate-btn").click(); break;
    case "r": if (!$("reset-btn").disabled) handleReset(); break;
    case "h": if (!$("hint-btn").disabled) handleHint(); break;
    case "p": if (!$("preview-btn").disabled) handlePreview(); break;
    case "d": if (!$("download-btn").disabled) downloadPainted(); break;
    case "m": $("sound-toggle").click(); break;
    case "b": selectTool("brush"); break;
    case "f": selectTool("bucket"); break;
    case "e": selectTool("eraser"); break;
    case "+": case "=": zoomBy(1); break;
    case "-": case "_": zoomBy(-1); break;
    case "0": zoomIdx = 2; applyZoom(); break;
    case "?":
    case "/":
      FX.toast("Клавиши: G ген, R сброс, H хинт, P оригинал, D скачать, M звук. Инструменты: B кисть, F заливка, E ластик. 1-9 цвета. Esc закрыть.", { kind: "info", duration: 8000 });
      break;
    default:
      // 1-9 = выбор цвета
      if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < state.palette.length) selectColor(idx);
      }
  }
});
$("generate-btn").addEventListener("click", generate);
$("hint-btn").addEventListener("click", handleHint);
$("preview-btn").addEventListener("click", handlePreview);
$("reset-btn").addEventListener("click", handleReset);
$("finish-close").addEventListener("click", () => $("finish-modal").classList.add("hidden"));
$("prompt").addEventListener("keydown", (e) => { if (e.key === "Enter") generate(); });
$("sound-toggle").addEventListener("change", (e) => {
  window.FX && FX.setEnabled(e.target.checked);
  try { localStorage.setItem("pixelforge:sound", e.target.checked ? "1" : "0"); } catch (_) {}
});
try {
  const saved = localStorage.getItem("pixelforge:sound");
  if (saved === "0") { $("sound-toggle").checked = false; window.FX && FX.setEnabled(false); }
} catch (_) {}

/* ---------- autosave ---------- */
const SAVE_KEY = "pixelforge:session";
const BEST_STREAK_KEY = "pixelforge:bestStreak";
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSession, 350);
}
function saveSession() {
  if (!state.gridSize) return;
  try {
    const data = {
      v: 1,
      prompt: $("prompt").value,
      backend: $("backend").value,
      gridSize: state.gridSize,
      palette: state.palette,
      indices: state.indices,
      filled: packBits(state.filled),
      errors: state.errors,
      bestStreak: state.bestStreak,
      ts: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    localStorage.setItem(BEST_STREAK_KEY, String(state.bestStreak));
  } catch (_) { /* quota — игнор */ }
}
function packBits(grid) {
  return grid.map((row) => {
    let s = "";
    for (const v of row) s += v ? "1" : "0";
    return s;
  });
}
function unpackBits(packed) {
  return packed.map((row) => row.split("").map((c) => c === "1"));
}
function loadSession() {
  let raw;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (_) { return false; }
  if (!raw) return false;
  try {
    const d = JSON.parse(raw);
    if (d.v !== 1 || !d.palette || !d.indices) return false;
    // если сохранена завершённая раскраска — не подгружаем
    let _filledCount = 0;
    const _unp = unpackBits(d.filled);
    for (const row of _unp) for (const v of row) if (v) _filledCount++;
    if (_filledCount >= d.gridSize * d.gridSize) return false;
    $("prompt").value = d.prompt || "";
    if (d.backend) $("backend").value = d.backend;
    state.gridSize = d.gridSize;
    state.palette = d.palette;
    state.indices = d.indices;
    state.filled = unpackBits(d.filled);
    state.errors = d.errors || 0;
    state.bestStreak = d.bestStreak || 0;
    state.streak = 0;
    state.filledCells = 0;
    state.totalCells = d.gridSize * d.gridSize;
    for (let y = 0; y < d.gridSize; y++)
      for (let x = 0; x < d.gridSize; x++)
        if (state.filled[y][x]) state.filledCells++;
    state.previewB64 = null;     // не храним в LS — большой
    state.startedAt = performance.now();
    state.selectedColor = null;
    $("errors-count").textContent = state.errors;
    $("preview-btn").disabled = true;   // оригинал не сохранён
    $("reset-btn").disabled = false;
    buildPalette();
    applyZoom();   // пересчитываем буфер для нового grid
    updateStreak();
    updateProgress();
    repaint();
    startTimer();
    $("download-btn").disabled = false;
    return true;
  } catch (_) { return false; }
}
function clearSession() {
  try { localStorage.removeItem(SAVE_KEY); } catch (_) {}
}

// глобальный bestStreak — даже при новой генерации
try {
  const gb = parseInt(localStorage.getItem(BEST_STREAK_KEY) || "0", 10);
  if (gb > 0) { state.bestStreak = gb; updateStreak(); }
} catch (_) {}

clearCanvas();
ctx.fillStyle = "#888";
ctx.font = "20px JetBrains Mono, Consolas, monospace";
ctx.textAlign = "center";
ctx.fillText("Введи промпт и жми Generate ⚡", CANVAS_PX / 2, CANVAS_PX / 2);

if (loadSession()) {
  setTimeout(() => {
    const pct = ((state.filledCells / state.totalCells) * 100).toFixed(0);
    FX.toast(`Восстановлена прошлая раскраска (${pct}%)`, { kind: "success", duration: 4500 });
  }, 250);
}
