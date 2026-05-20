# PixelForge 🎨

Генератор пиксель-арта + **paint-by-numbers** редактор. AI рисует — ты раскрашиваешь по номерам.

## Что умеет

**Генерация:**
- 🌐 **FLUX.1-schnell / FLUX.1-dev** через NVIDIA Build API — ~3 сек, отлично понимает промпт
- 🏠 **Local SDXL + pixel-art LoRA** на твоей GPU (offline)
- Любую картинку пропускает через post-process: ресайз → k-means квантизация → честный pixel grid с ограниченной палитрой

**Игра — paint by numbers:**
- Драг-мышью / тач для закраски подряд
- Combo-стрик с метками 5/10/25/50 и звуковыми милстоунами
- Hover-индикатор (правильный цвет — зелёный, неправильный — красный)
- Pulse-анимация на закрашенной клетке
- Confetti + фанфары на 100%
- 10 ачивок (PERFECT, SPEEDRUN, MEGA_STREAK, BIG_GRID, NO_HINTS, EXPLORER...)
- Live таймер
- 26 промпт-пресетов одним кликом + 🎲 кнопка для случайного
- Уровни сложности: Easy / Normal / Hard / Custom
- Автосохранение прогресса в localStorage — закрыл вкладку, открыл, продолжил
- История промптов (datalist в инпуте)
- Скачать раскрашенный PNG (×16 апскейл, NEAREST)
- Звуки через Web Audio API (выключаются)
- Mobile touch + responsive layout
- Onboarding-тосты при первом визите
- Health-ping каждые 30 сек с офлайн-индикатором
- Клавиши: G ген, R сброс, H хинт, A залить, P оригинал, D скачать, M звук, 1-9 цвета, Esc — закрыть

## Стек
- **Backend:** FastAPI + Pydantic + Pillow + scikit-learn (k-means + MiniBatchKMeans)
- **Generation:** diffusers + SDXL 1.0 + LoRA `nerijs/pixel-art-xl` (локально), NVIDIA Build API (FLUX.1)
- **Frontend:** vanilla HTML/Canvas/JS — без фреймворков, всё статично

## Запуск

```powershell
# 1) Скопировать .env.example → .env, вставить ключ
copy .env.example .env
# Edit .env: NVIDIA_API_KEY=nvapi-...

# 2) Поставить зависимости (если venv ещё не создан)
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
# или вручную:
# torch torchvision (для CUDA — https://pytorch.org/get-started/locally)
# diffusers transformers accelerate safetensors peft huggingface-hub hf_transfer
# fastapi uvicorn pillow numpy scikit-learn python-dotenv requests

# 3) (опционально) Заранее скачать SDXL+LoRA для local-режима
.\.venv\Scripts\python.exe -m backend.download_models

# 4) Старт сервера
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --port 8000
```

Открыть **http://localhost:8000**

⚠️ Не открывай `index.html` напрямую как файл — фронту нужен `/api/*` от FastAPI.

## Структура

```
pixelforge/
├── backend/
│   ├── main.py              FastAPI: /api/generate, /api/health
│   ├── nvidia_flux.py       NVIDIA Build API клиент (FLUX.1)
│   ├── generate.py          Local SDXL+LoRA пайплайн
│   ├── pixelify.py          k-means → pixel grid + палитра + индексы
│   └── download_models.py   ретрай-скачивание SDXL для нестабильной сети
├── frontend/
│   ├── index.html
│   ├── style.css            редизайн с градиентами, glassmorphism, mobile
│   ├── app.js               логика игры, таймер, рисование, шорткаты
│   ├── fx.js                Web Audio + confetti + toasts
│   └── achievements.js      ачивки в localStorage
├── outputs/                 сгенерированные картинки (raw + pixel)
├── models_cache/            HF cache (SDXL, LoRA)
└── .env                     NVIDIA_API_KEY (НЕ коммитить)
```

## API

`POST /api/generate`
```json
{
  "prompt": "diamond sword",
  "backend": "flux-schnell",
  "grid_size": 32,
  "n_colors": 12,
  "seed": 42
}
```

Ответ:
```json
{
  "prompt": "diamond sword",
  "backend": "flux-schnell",
  "grid_size": 32,
  "palette": ["#aabbcc", "..."],
  "indices": [[0, 1, 2, ...], ...],
  "preview_b64": "...",
  "elapsed_sec": 3.5
}
```

## Что под капотом квантизации
1. SDXL/FLUX даёт 1024×1024 картинку
2. `pixelify.py` уменьшает до `grid_size × grid_size` (LANCZOS)
3. KMeans (или MiniBatchKMeans для >=4096 пикселей) кластеризует все RGB-векторы пикселей в N центров
4. Каждый пиксель получает индекс цвета из палитры
5. Backend отдаёт `palette` + `indices` фронту — фронт строит paint-by-numbers сетку
