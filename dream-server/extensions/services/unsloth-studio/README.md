# Unsloth Studio (Fine-tuning)

Fine-tune open-source LLMs on custom datasets using [Unsloth Studio](https://unsloth.ai/).
GPU-only service — requires AMD (ROCm) or NVIDIA GPU.

## Enable

```bash
dream enable unsloth-studio
dream start unsloth-studio
```

Then open: `http://<host>:7680`

## Fine-tuning Workflow

1. **Download** a base model into your models directory (`${AI_MODELS_PATH:-./data/models}`)
2. **Open** Unsloth Studio and select the model from `/models`
3. **Upload** your dataset (JSONL chat format recommended)
4. **Train** — outputs saved to `/workspace/outputs/`
5. **Register** the fine-tuned model in LiteLLM config
6. **Switch** via `/model <finetuned-name>` in OpenWebUI or OpenClaw

## AMD Notes

For AMD Strix Halo (gfx1151), see:
[kyuz0/amd-strix-halo-llm-finetuning](https://github.com/kyuz0/amd-strix-halo-llm-finetuning)
for ROCm-specific tips and optimized training configs.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AI_MODELS_PATH` | `./data/models` | Path to shared model storage |
| `UNSLOTH_PORT` | `7680` | External port |
| `VIDEO_GID` | `44` | Host video group ID (AMD only) |
| `RENDER_GID` | `992` | Host render group ID (AMD only) |
