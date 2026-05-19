"""SDXL + pixel-art LoRA generation."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import torch
from diffusers import StableDiffusionXLPipeline, EulerDiscreteScheduler
from PIL import Image

CACHE_DIR = Path(__file__).resolve().parent.parent / "models_cache"

BASE_MODEL = "stabilityai/stable-diffusion-xl-base-1.0"
LORA_REPO = "nerijs/pixel-art-xl"
LORA_WEIGHT = "pixel-art-xl.safetensors"

PROMPT_PREFIX = "pixel art, "
PROMPT_SUFFIX = ", 16-bit, retro game asset, vibrant colors, sharp pixels"
NEGATIVE = (
    "blurry, soft, anti-aliased, photorealistic, smooth gradients, "
    "3d render, depth of field, realistic, painting"
)


class PixelArtGenerator:
    _pipe: Optional[StableDiffusionXLPipeline] = None

    def __init__(self, device: str = "cuda", dtype=torch.float16):
        self.device = device
        self.dtype = dtype

    def load(self) -> None:
        if self._pipe is not None:
            return
        pipe = StableDiffusionXLPipeline.from_pretrained(
            BASE_MODEL,
            torch_dtype=self.dtype,
            variant="fp16",
            use_safetensors=True,
            cache_dir=CACHE_DIR,
        )
        pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config)
        pipe.load_lora_weights(LORA_REPO, weight_name=LORA_WEIGHT, cache_dir=CACHE_DIR)
        pipe.fuse_lora(lora_scale=1.0)
        pipe.to(self.device)
        pipe.set_progress_bar_config(disable=True)
        self._pipe = pipe

    def generate(
        self,
        prompt: str,
        *,
        steps: int = 25,
        guidance: float = 7.5,
        width: int = 1024,
        height: int = 1024,
        seed: Optional[int] = None,
    ) -> Image.Image:
        if self._pipe is None:
            self.load()
        full_prompt = f"{PROMPT_PREFIX}{prompt}{PROMPT_SUFFIX}"
        generator = None
        if seed is not None:
            generator = torch.Generator(device=self.device).manual_seed(seed)
        out = self._pipe(
            prompt=full_prompt,
            negative_prompt=NEGATIVE,
            num_inference_steps=steps,
            guidance_scale=guidance,
            width=width,
            height=height,
            generator=generator,
        )
        return out.images[0]


_singleton: Optional[PixelArtGenerator] = None


def get_generator() -> PixelArtGenerator:
    global _singleton
    if _singleton is None:
        _singleton = PixelArtGenerator()
        _singleton.load()
    return _singleton


if __name__ == "__main__":
    import sys

    prompt = " ".join(sys.argv[1:]) or "cute red dragon"
    gen = get_generator()
    img = gen.generate(prompt, seed=42)
    out_path = Path(__file__).resolve().parent.parent / "outputs" / "test_raw.png"
    out_path.parent.mkdir(exist_ok=True)
    img.save(out_path)
    print(f"saved -> {out_path}")
