"""FastAPI backend for PixelForge."""
from __future__ import annotations

import base64
import io
import time
from pathlib import Path
from typing import List, Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel, Field

from .nvidia_flux import get_flux_generator
from .pixelify import pixelify

# generate.py тащит torch/diffusers/SDXL — ленивый импорт чтобы FLUX-only режим стартовал быстро
def _get_local_generator():
    from .generate import get_generator
    return get_generator()

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT / "frontend"
OUTPUTS_DIR = ROOT / "outputs"
OUTPUTS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="PixelForge")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


BackendName = Literal["local", "flux-schnell", "flux-dev"]


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=300)
    backend: BackendName = "flux-schnell"
    grid_size: int = Field(32, ge=16, le=96)
    n_colors: int = Field(12, ge=4, le=32)
    steps: int = Field(4, ge=1, le=50)
    lora_scale: float = Field(0.8, ge=0.0, le=1.5)
    guidance: float = Field(0.0, ge=0.0, le=15.0)
    seed: Optional[int] = None


class GenerateResponse(BaseModel):
    prompt: str
    backend: str
    grid_size: int
    palette: List[str]
    indices: List[List[int]]
    preview_b64: str
    elapsed_sec: float


def _img_to_b64(img) -> str:
    """WebP в 3-4 раза легче PNG при тех же видимых пикселях."""
    buf = io.BytesIO()
    img.save(buf, format="WEBP", lossless=True, quality=100, method=4)
    return base64.b64encode(buf.getvalue()).decode("ascii")


@app.post("/api/generate", response_model=GenerateResponse)
def api_generate(req: GenerateRequest):
    t0 = time.time()
    try:
        if req.backend == "local":
            gen = _get_local_generator()
            raw = gen.generate(
                req.prompt,
                steps=req.steps if req.steps >= 8 else 28,
                seed=req.seed,
                lora_scale=req.lora_scale,
                guidance=req.guidance if req.guidance >= 1.0 else 7.0,
            )
        else:
            flux_prompt = f"{req.prompt}, pixel art, 16-bit retro game sprite, flat colors"
            flux_gen = get_flux_generator(req.backend)
            raw = flux_gen.generate(
                flux_prompt,
                steps=req.steps if req.backend == "flux-schnell" else max(req.steps, 25),
                guidance=req.guidance,
                seed=req.seed,
            )
        result = pixelify(raw, grid_size=req.grid_size, n_colors=req.n_colors)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    ts = int(time.time())
    raw.save(OUTPUTS_DIR / f"{ts}_raw.png")
    result.grid_upscaled.save(OUTPUTS_DIR / f"{ts}_pixel.png")

    return GenerateResponse(
        prompt=req.prompt,
        backend=req.backend,
        grid_size=result.grid_size,
        palette=result.palette_hex,
        indices=result.color_indices,
        preview_b64=_img_to_b64(result.grid_small.resize((384, 384), Image.Resampling.NEAREST)),
        elapsed_sec=round(time.time() - t0, 2),
    )


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
