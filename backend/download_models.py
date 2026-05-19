"""Качаем SDXL + LoRA с ретраями. Запускать перед стартом сервера если HF режется."""
from __future__ import annotations

import os
import time
from pathlib import Path

os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "1")

from huggingface_hub import snapshot_download

CACHE_DIR = Path(__file__).resolve().parent.parent / "models_cache"
CACHE_DIR.mkdir(exist_ok=True)

TARGETS = [
    {
        "repo_id": "stabilityai/stable-diffusion-xl-base-1.0",
        "allow_patterns": [
            "model_index.json",
            "scheduler/*",
            "tokenizer/*",
            "tokenizer_2/*",
            "text_encoder/*.fp16.safetensors",
            "text_encoder/config.json",
            "text_encoder_2/*.fp16.safetensors",
            "text_encoder_2/config.json",
            "unet/*.fp16.safetensors",
            "unet/config.json",
            "vae/*.fp16.safetensors",
            "vae/config.json",
        ],
    },
    {
        "repo_id": "nerijs/pixel-art-xl",
        "allow_patterns": ["pixel-art-xl.safetensors"],
    },
]


def pull(repo_id: str, allow_patterns):
    max_attempts = 8
    for attempt in range(1, max_attempts + 1):
        try:
            print(f"[{repo_id}] attempt {attempt}/{max_attempts}...")
            path = snapshot_download(
                repo_id=repo_id,
                cache_dir=CACHE_DIR,
                allow_patterns=allow_patterns,
                max_workers=2,
                resume_download=True,
            )
            print(f"[{repo_id}] OK -> {path}")
            return
        except Exception as e:
            print(f"[{repo_id}] attempt {attempt} failed: {type(e).__name__}: {e}")
            if attempt == max_attempts:
                raise
            sleep_s = min(2 ** attempt, 30)
            print(f"  waiting {sleep_s}s before retry...")
            time.sleep(sleep_s)


def main():
    for t in TARGETS:
        pull(t["repo_id"], t["allow_patterns"])
    print("\nAll models downloaded.")


if __name__ == "__main__":
    main()
