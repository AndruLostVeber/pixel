"""Превращаем SD-output в честный pixel grid с ограниченной палитрой."""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple

import numpy as np
from PIL import Image
from sklearn.cluster import KMeans, MiniBatchKMeans


@dataclass
class PixelResult:
    grid_small: Image.Image          # картинка размером grid_size × grid_size
    grid_upscaled: Image.Image       # та же, апскейл NEAREST до display_size
    palette_hex: List[str]           # ["#aabbcc", ...] длины n_colors
    color_indices: List[List[int]]   # 2D матрица индексов в палитре (grid_size × grid_size)
    grid_size: int


def _rgb_to_hex(rgb: Tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def pixelify(
    image: Image.Image,
    *,
    grid_size: int = 48,
    n_colors: int = 16,
    display_size: int = 768,
    random_state: int = 0,
) -> PixelResult:
    """Downscale -> k-means quantize -> upscale NEAREST."""
    small = image.convert("RGB").resize((grid_size, grid_size), Image.Resampling.LANCZOS)
    arr = np.asarray(small, dtype=np.uint8).reshape(-1, 3)

    n_unique = len(np.unique(arr, axis=0))
    k = min(n_colors, n_unique)

    # больший grid — MiniBatchKMeans быстрее на ~3x с близким качеством
    if arr.shape[0] >= 4096:
        km = MiniBatchKMeans(n_clusters=k, n_init=3, random_state=random_state, batch_size=1024).fit(arr)
    else:
        km = KMeans(n_clusters=k, n_init=3, random_state=random_state).fit(arr)
    palette_rgb = np.round(km.cluster_centers_).astype(np.uint8)
    labels = km.labels_.reshape(grid_size, grid_size)

    quantized = palette_rgb[labels]                                   # (H, W, 3)
    small_quantized = Image.fromarray(quantized.astype(np.uint8), mode="RGB")
    upscaled = small_quantized.resize((display_size, display_size), Image.Resampling.NEAREST)

    palette_hex = [_rgb_to_hex(tuple(c)) for c in palette_rgb]
    color_indices = labels.astype(int).tolist()

    return PixelResult(
        grid_small=small_quantized,
        grid_upscaled=upscaled,
        palette_hex=palette_hex,
        color_indices=color_indices,
        grid_size=grid_size,
    )


if __name__ == "__main__":
    import sys
    from pathlib import Path
    import json

    src = sys.argv[1] if len(sys.argv) > 1 else "outputs/test_raw.png"
    img = Image.open(src)
    res = pixelify(img, grid_size=48, n_colors=16)
    out_dir = Path("outputs")
    out_dir.mkdir(exist_ok=True)
    res.grid_upscaled.save(out_dir / "test_pixel.png")
    (out_dir / "test_palette.json").write_text(
        json.dumps({"palette": res.palette_hex, "indices": res.color_indices})
    )
    print(f"saved -> {out_dir/'test_pixel.png'} ({len(res.palette_hex)} colors)")
