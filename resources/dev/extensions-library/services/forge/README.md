# Forge / A1111

The original Stable Diffusion web UI (based on Automatic1111). Features extensive model support, extensions, inpainting, outpainting, and professional-grade image generation capabilities.

## Requirements

- **GPU:** NVIDIA (min 8 GB VRAM)
- **Dependencies:** None

## Enable / Disable

```bash
dream enable forge
dream disable forge
```

Your data is preserved when disabling. To re-enable later: `dream enable forge`

## Access

- **URL:** `http://localhost:7861`

## First-Time Setup

1. Enable the service: `dream enable forge`
2. Open `http://localhost:7861`
3. Start generating images with the txt2img tab

First startup may download several GB of model files. Subsequent starts are instant.

### API Usage

```bash
# Generate via txt2img API
curl -X POST http://localhost:7861/sdapi/v1/txt2img \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "a photo of a cat in a garden",
    "steps": 20,
    "width": 512,
    "height": 512
  }'

# Check progress
curl http://localhost:7861/sdapi/v1/progress
```
