# Stiekefotos

## Z-Image-Turbo Integration Notes

This project uses the Hugging Face demo Space `Tongyi-MAI/Z-Image-Turbo` for image generation in prototype flows.

- **Required in production:** set `HF_TOKEN` (read token) in environment.
- **Local dev:** `HF_TOKEN` is optional, but ZeroGPU quota is IP-bucketed and will fail quickly without a token.
- **API contract:** calls use `api_name="/generate"` through `gradio_client` and pass exactly:
  - `prompt`
  - `resolution` (must be one of the exact literals from the Space)
  - `seed`
  - `steps=8`
  - `shift`
  - `random_seed`
  - `gallery_images=None`
- **Resolution literals:** the integration validates resolution strictly and fails fast on invalid values.
- **NSFW behavior:** upstream can return a fixed placeholder image (`nsfw.png`) while call itself succeeds; integration classifies this as `nsfw_blocked`.

### Production recommendation

The public demo Space is for prototyping and low-volume usage. For production, self-host Z-Image-Turbo (Apache-2.0) on dedicated infrastructure (e.g., RunPod/Modal/own GPU endpoint). The model class targets **~16GB VRAM** setups for stable throughput.

