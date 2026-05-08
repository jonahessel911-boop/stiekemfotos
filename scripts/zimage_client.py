#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import shutil
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
import inspect
from typing import Literal

from gradio_client import Client
from gradio_client.exceptions import AppError

log = logging.getLogger("zimage")
logging.basicConfig(level=logging.INFO)

SPACE_ID = "Tongyi-MAI/Z-Image-Turbo"
API_NAME = "/generate"

RESOLUTION_SET: frozenset[str] = frozenset(
    {
        "1024x1024 ( 1:1 )",
        "1152x896 ( 9:7 )",
        "896x1152 ( 7:9 )",
        "1152x864 ( 4:3 )",
        "864x1152 ( 3:4 )",
        "1248x832 ( 3:2 )",
        "832x1248 ( 2:3 )",
        "1280x720 ( 16:9 )",
        "720x1280 ( 9:16 )",
        "1344x576 ( 21:9 )",
        "576x1344 ( 9:21 )",
        "1280x1280 ( 1:1 )",
        "1440x1120 ( 9:7 )",
        "1120x1440 ( 7:9 )",
        "1472x1104 ( 4:3 )",
        "1104x1472 ( 3:4 )",
        "1536x1024 ( 3:2 )",
        "1024x1536 ( 2:3 )",
        "1536x864 ( 16:9 )",
        "864x1536 ( 9:16 )",
        "1680x720 ( 21:9 )",
        "720x1680 ( 9:21 )",
        "1536x1536 ( 1:1 )",
        "1728x1344 ( 9:7 )",
        "1344x1728 ( 7:9 )",
        "1728x1296 ( 4:3 )",
        "1296x1728 ( 3:4 )",
        "1872x1248 ( 3:2 )",
        "1248x1872 ( 2:3 )",
        "2048x1152 ( 16:9 )",
        "1152x2048 ( 9:16 )",
        "2016x864 ( 21:9 )",
        "864x2016 ( 9:21 )",
    }
)

NSFW_PLACEHOLDER_SHA256: str | None = os.environ.get("NSFW_PLACEHOLDER_SHA256")


@dataclass(frozen=True)
class GenerationResult:
    status: Literal["success", "nsfw_blocked", "failed"]
    image_path: str | None
    seed: int | None
    duration_s: float
    error: str | None = None


class QuotaExceededError(RuntimeError):
    pass


def is_nsfw_placeholder(image_bytes: bytes) -> bool:
    if NSFW_PLACEHOLDER_SHA256 is None:
        return False
    return hashlib.sha256(image_bytes).hexdigest() == NSFW_PLACEHOLDER_SHA256


class ZImageClient:
    def __init__(self, hf_token: str | None = None):
        self.hf_token = hf_token or os.environ.get("HF_TOKEN")
        if not self.hf_token:
            log.warning(
                "HF_TOKEN missing. ZeroGPU quota will be shared by IP and likely fail quickly."
            )
        self._client: Client | None = None

    def _get_client(self) -> Client:
        if self._client is None:
            params = inspect.signature(Client).parameters
            if "token" in params:
                self._client = Client(SPACE_ID, token=self.hf_token)
            else:
                self._client = Client(SPACE_ID, hf_token=self.hf_token)
        return self._client

    def generate(
        self,
        prompt: str,
        *,
        resolution: str = "1024x1024 ( 1:1 )",
        seed: int = 42,
        shift: float = 3.0,
        random_seed: bool = True,
        output_dir: str = "/tmp",
    ) -> GenerationResult:
        if resolution not in RESOLUTION_SET:
            raise ValueError(
                f"Invalid resolution {resolution!r}. Must be one of RESOLUTION_SET."
            )

        prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()[:12]
        t0 = time.monotonic()
        log.info(
            "z-image generate start prompt_hash=%s resolution=%s random_seed=%s",
            prompt_hash,
            resolution,
            random_seed,
        )
        try:
            gallery, seed_str, _seed_int = self._get_client().predict(
                prompt,  # 0
                resolution,  # 1
                seed,  # 2
                8,  # 3 fixed by UI contract
                shift,  # 4
                random_seed,  # 5
                None,  # 6
                api_name=API_NAME,
            )
        except AppError as e:
            duration = time.monotonic() - t0
            msg = str(e)
            if "ZeroGPU quota" in msg or "quota exceeded" in msg.lower():
                log.warning(
                    "z-image quota exceeded prompt_hash=%s duration_s=%.3f error=%s",
                    prompt_hash,
                    duration,
                    msg,
                )
                raise QuotaExceededError(msg) from e
            log.error(
                "z-image upstream error prompt_hash=%s duration_s=%.3f error=%s",
                prompt_hash,
                duration,
                msg,
            )
            return GenerationResult("failed", None, None, duration, msg)
        except Exception as e:
            duration = time.monotonic() - t0
            msg = str(e)
            log.error(
                "z-image unexpected error prompt_hash=%s duration_s=%.3f error=%s",
                prompt_hash,
                duration,
                msg,
            )
            return GenerationResult("failed", None, None, duration, msg)

        duration = time.monotonic() - t0
        src_path = self._extract_first_image_path(gallery)
        used_seed = int(seed_str)
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"zimage_{prompt_hash}_{used_seed}.png"
        shutil.copy(src_path, out_path)

        image_bytes = out_path.read_bytes()
        nsfw = is_nsfw_placeholder(image_bytes)
        status: Literal["success", "nsfw_blocked"] = "nsfw_blocked" if nsfw else "success"
        log.info(
            "z-image generate %s prompt_hash=%s resolution=%s seed=%s duration_s=%.3f",
            status,
            prompt_hash,
            resolution,
            used_seed,
            duration,
        )
        return GenerationResult(status, str(out_path), used_seed, duration)

    @staticmethod
    def _extract_first_image_path(gallery: object) -> Path:
        if not gallery:
            raise RuntimeError("Gallery is empty; no image to extract.")

        if not isinstance(gallery, list):
            raise RuntimeError(
                f"Unexpected gallery container format: type={type(gallery).__name__} value={gallery!r}"
            )

        item = gallery[0]

        if isinstance(item, str):
            return Path(item)

        if isinstance(item, (list, tuple)) and len(item) >= 1:
            head = item[0]
            if isinstance(head, str):
                return Path(head)
            if isinstance(head, dict):
                path = head.get("path") or head.get("url")
                if isinstance(path, str):
                    return Path(path)

        if isinstance(item, dict):
            image = item.get("image")
            if isinstance(image, str):
                return Path(image)
            if isinstance(image, dict):
                path = image.get("path") or image.get("url")
                if isinstance(path, str):
                    return Path(path)

        raise RuntimeError(
            f"Unexpected gallery item format: type={type(item).__name__} value={item!r}"
        )

    def generate_with_retry(
        self,
        prompt: str,
        *,
        max_attempts: int = 3,
        backoff_base_s: float = 60.0,
        **kwargs,
    ) -> GenerationResult:
        last_err: str | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                return self.generate(prompt, **kwargs)
            except QuotaExceededError as e:
                last_err = str(e)
                if attempt == max_attempts:
                    break
                wait = backoff_base_s * (2 ** (attempt - 1))
                log.info("z-image quota retry sleeping %.1fs attempt=%d", wait, attempt)
                time.sleep(wait)
        return GenerationResult(
            "failed",
            None,
            None,
            0.0,
            f"quota exceeded after {max_attempts} attempts: {last_err}",
        )


def cmd_generate() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--resolution", required=True)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--shift", type=float, default=3.0)
    parser.add_argument("--random-seed", choices=["true", "false"], default="true")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--max-attempts", type=int, default=3)
    args = parser.parse_args(sys.argv[2:])

    client = ZImageClient()
    result = client.generate_with_retry(
        args.prompt,
        resolution=args.resolution,
        seed=args.seed,
        shift=args.shift,
        random_seed=args.random_seed == "true",
        output_dir=args.output_dir,
        max_attempts=args.max_attempts,
        backoff_base_s=60.0,
    )
    print(json.dumps(asdict(result)))
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: zimage_client.py generate ...", file=sys.stderr)
        return 2
    if sys.argv[1] == "generate":
        return cmd_generate()
    print(f"unknown command: {sys.argv[1]}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

