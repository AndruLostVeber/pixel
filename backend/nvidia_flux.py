"""Генерация через NVIDIA Build API (FLUX.1-schnell / FLUX.1-dev).

Документация: https://build.nvidia.com/black-forest-labs/flux_1-schnell
"""
from __future__ import annotations

import base64
import io
import os
import time
from typing import Optional

import requests
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

INVOKE_URLS = {
    "flux-schnell": "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell",
    "flux-dev": "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev",
}
NVCF_STATUS_URL = "https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/{req_id}"


class NvidiaFluxGenerator:
    def __init__(self, model: str = "flux-schnell"):
        self.model = model
        self.api_key = os.environ.get("NVIDIA_API_KEY")
        if not self.api_key:
            raise RuntimeError(
                "NVIDIA_API_KEY не задан. Создай .env с NVIDIA_API_KEY=nvapi-..."
            )
        if model not in INVOKE_URLS:
            raise ValueError(f"unknown model '{model}', choose from {list(INVOKE_URLS)}")

    def generate(
        self,
        prompt: str,
        *,
        steps: int = 4,
        guidance: float = 0.0,
        width: int = 1024,
        height: int = 1024,
        seed: Optional[int] = None,
    ) -> Image.Image:
        url = INVOKE_URLS[self.model]
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        }
        payload = {
            "prompt": prompt,
            "cfg_scale": float(guidance),
            "seed": int(seed) if seed is not None else 0,
            "steps": int(steps),
            "width": int(width),
            "height": int(height),
            "mode": "base",
        }

        with requests.Session() as s:
            r = s.post(url, headers=headers, json=payload, timeout=120)
            # NVCF async fallback
            while r.status_code == 202:
                req_id = r.headers.get("nvcf-reqid") or r.headers.get("NVCF-REQID")
                if not req_id:
                    break
                time.sleep(1.5)
                r = s.get(
                    NVCF_STATUS_URL.format(req_id=req_id),
                    headers=headers,
                    timeout=60,
                )

            if not r.ok:
                raise RuntimeError(f"NVIDIA API {r.status_code}: {r.text[:400]}")

            data = r.json()

        b64 = self._extract_b64(data)
        return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")

    @staticmethod
    def _extract_b64(data: dict) -> str:
        if isinstance(data.get("artifacts"), list) and data["artifacts"]:
            art = data["artifacts"][0]
            if "base64" in art:
                return art["base64"]
        if "image" in data:
            return data["image"]
        if isinstance(data.get("response"), dict):
            return NvidiaFluxGenerator._extract_b64(data["response"])
        raise RuntimeError(f"не нашёл картинку в ответе: keys={list(data)[:8]}")


_singletons: dict[str, NvidiaFluxGenerator] = {}


def get_flux_generator(model: str = "flux-schnell") -> NvidiaFluxGenerator:
    if model not in _singletons:
        _singletons[model] = NvidiaFluxGenerator(model=model)
    return _singletons[model]


if __name__ == "__main__":
    import sys

    prompt = " ".join(sys.argv[1:]) or "russian flag waving on a flagpole"
    gen = get_flux_generator("flux-schnell")
    img = gen.generate(prompt, seed=42)
    img.save("outputs/flux_test.png")
    print("saved -> outputs/flux_test.png")
