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

let animLoopRunning = false;
function animLoop() {
  if (state.pulses.length) {
    // быстрая перерисовка зоны пульсов
    drawFilledCells();
    drawPulses();
    drawGrid();
    drawNumbers();
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
    state.streak++;
    if (state.streak > state.bestStreak) state.bestStreak = state.streak;
    updateStreak();
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
    flashCell(cell.x, cell.y, "rgba(255,80,80,0.85)", 220);
  }
}

function handleMouseMove(ev) {
  const cell = cellFromEvent(ev);
  state.hoverCell = cell;
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
}

function handleHint() {
  if (state.selectedColor == null) return;
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
  if (state.filledCells === state.totalCells) onFinish();
}

function handlePreview() {
  if (!state.previewB64) return;
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, CANVAS_PX, CANVAS_PX);
    setTimeout(() => repaint(), 1500);
  };
  img.src = "data:image/png;base64," + state.previewB64;
}

function handleReset() {
  if (!confirm("Точно сбросить всю раскраску?")) return;
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
  $("finish-preview").src = "data:image/png;base64," + state.previewB64;
  $("finish-modal").classList.remove("hidden");
}

/* ---------- generation ---------- */

async function generate() {
  const prompt = $("prompt").value.trim();
  if (!prompt) { alert("Введи промпт"); return; }
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
  } catch (e) {
    alert("Ошибка: " + e.message);
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
}

/* ---------- init ---------- */

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

clearCanvas();
ctx.fillStyle = "#888";
ctx.font = "20px JetBrains Mono, Consolas, monospace";
ctx.textAlign = "center";
ctx.fillText("Введи промпт и жми Generate ⚡", CANVAS_PX / 2, CANVAS_PX / 2);
