# PixelForge — генератор + paint-by-numbers пиксель-арта

SDXL + pixel-art LoRA генерит картинку, post-process квантизует её в честный пиксель-грид с ограниченной палитрой, фронт превращает результат в **раскраску по номерам**.

## Запуск

```powershell
cd C:\Users\PC\Desktop\pixelforge
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --port 8000
```

Открыть http://localhost:8000 (НЕ файл напрямую — фронт ходит в `/api/*`).

Первый запрос грузит SDXL (~7GB) и LoRA. Дальше — секунды.

## Стек
- **diffusers** + SDXL 1.0 base + `nerijs/pixel-art-xl` LoRA
- post-process: PIL resize + k-means quantize (sklearn)
- backend: FastAPI
- frontend: vanilla HTML/Canvas/JS

## Файлы
- `backend/generate.py` — SDXL пайплайн
- `backend/pixelify.py` — downscale + k-means → grid + палитра
- `backend/main.py` — FastAPI endpoints
- `frontend/` — paint-by-numbers редактор
- `outputs/` — все сгенерированные картинки
