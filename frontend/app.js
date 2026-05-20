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
  // drag-to-paint
  isDragging: false,
  dragErrorThisStroke: false,  // штрафуем только за первый клик в стрике
  hoverCell: null,             // {x,y} текущая клетка под курсором
  // combo / pulse
  streak: 0,
  bestStreak: 0,
  pulses: [],  // [{x,y,t0,color}], затухающая подсветка только что закрашенных
};

/* ---------- rendering ---------- */

function clearCanvas() {
  ctx.fillStyle = "#f7f7f0";
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);
}

function drawGrid() {
  const { gridSize, cellPx } = state;
  ctx.strokeStyle = "#d8d6c8";
  ctx.lineWidth = 1;
  for (let i = 0; i <= gridSize; i++) {
    const p = Math.round(i * cellPx) + 0.5;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, CANVAS_PX); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(CANVAS_PX, p); ctx.stroke();
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
  // всегда перерисуй если есть pulses ИЛИ hover
  if (state.pulses.length || state.hoverCell || state.isDragging) {
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
  $("hint-btn").disabled = false;
  $("autofill-btn").disabled = false;
  window.FX && FX.select();
}

/* ---------- interactions ---------- */

function cellFromEvent(ev) {
  const rect = canvas.getBoundingClientRect();
  const px = (ev.clientX - rect.left) * (CANVAS_PX / rect.width);
  const py = (ev.clientY - rect.top) * (CANVAS_PX / rect.height);
  const x = Math.floor(px / state.cellPx);
  const y = Math.floor(py / state.cellPx);
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

function handleMouseDown(ev) {
  if (ev.button !== 0) return;
  if (state.selectedColor == null) return;
  const cell = cellFromEvent(ev);
  if (!cell) return;
  state.isDragging = true;
  state.dragErrorThisStroke = false;
  const res = paintCell(cell.x, cell.y);
  if (res === "hit") {
    drawGrid();
    updateProgress();
    updateRemaining();
    if (state.filledCells === state.totalCells) onFinish();
  } else if (res === "miss") {
    state.errors++;
    state.dragErrorThisStroke = true;
    $("errors-count").textContent = state.errors;
    breakStreak();
    window.FX && FX.miss();
    flashCell(cell.x, cell.y, "rgba(255,80,80,0.85)", 220);
  }
}

function handleMouseMove(ev) {
  const cell = cellFromEvent(ev);
  const prev = state.hoverCell;
  state.hoverCell = cell;
  if (!prev || !cell || prev.x !== cell.x || prev.y !== cell.y) kickAnim();
  if (state.isDragging && state.selectedColor != null && cell) {
    // во время drag — только закрашиваем правильные клетки, без штрафа за случайные мазки по неправильным
    const res = paintCell(cell.x, cell.y);
    if (res === "hit") {
      drawGrid();
      updateProgress();
      updateRemaining();
      if (state.filledCells === state.totalCells) onFinish();
    }
  }
}

function handleMouseUp() {
  state.isDragging = false;
  state.dragErrorThisStroke = false;
}

function handleMouseLeave() {
  state.isDragging = false;
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

function handleAutofill() {
  if (state.selectedColor == null) return;
  window.Achievements && Achievements.noteHintUsed();
  let count = 0;
  for (let y = 0; y < state.gridSize; y++) {
    for (let x = 0; x < state.gridSize; x++) {
      if (!state.filled[y][x] && state.indices[y][x] === state.selectedColor) {
        state.filled[y][x] = true;
        count++;
      }
    }
  }
  state.filledCells += count;
  updateProgress();
  updateRemaining();
  repaint();
  scheduleSave();
  if (state.filledCells === state.totalCells) onFinish();
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

function onFinish() {
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
  } catch (e) {
    FX.toast("Ошибка: " + e.message, { kind: "error", duration: 6000 });
  } finally {
    $("status").classList.add("hidden");
    $("generate-btn").disabled = false;
  }
}

function loadResult(data) {
  state.gridSize = data.grid_size;
  state.cellPx = CANVAS_PX / data.grid_size;
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

  $("errors-count").textContent = 0;
  $("preview-btn").disabled = false;
  $("reset-btn").disabled = false;
  $("hint-btn").disabled = true;
  $("autofill-btn").disabled = true;

  buildPalette();
  updateProgress();
  repaint();
  scheduleSave();
}

/* ---------- init ---------- */

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

canvas.addEventListener("mousedown", handleMouseDown);
canvas.addEventListener("mousemove", handleMouseMove);
window.addEventListener("mouseup", handleMouseUp);
canvas.addEventListener("mouseleave", handleMouseLeave);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
$("generate-btn").addEventListener("click", generate);
$("hint-btn").addEventListener("click", handleHint);
$("autofill-btn").addEventListener("click", handleAutofill);
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
    state.cellPx = CANVAS_PX / d.gridSize;
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
    updateStreak();
    updateProgress();
    repaint();
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
