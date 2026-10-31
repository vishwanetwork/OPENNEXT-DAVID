# GPU thumbnail sources

Retrieved 2026-10-30. These are model-family product visuals; the table's numeric
specifications remain authoritative for each provider's actual configuration.
No vendor text or performance claims were imported.

- `gpu-h100.jpg`: NVIDIA H100 SXM product render. Original asset, unchanged.
  Product page: https://www.nvidia.com/en-us/data-center/h100/
  Image: https://www.nvidia.com/content/dam/en-zz/Solutions/gtcs22/data-center/h100/h100-og.jpg
- `gpu-h200.jpg`: NVIDIA HGX H200 platform product render. Original asset, unchanged.
  Product page: https://www.nvidia.com/en-us/data-center/h200/
  Image: https://www.nvidia.com/content/dam/en-zz/Solutions/Data-Center/h200/h200-tensor-og.jpg
- `gpu-b200.png`: NVIDIA B200 product introduction render displayed by TechInsights.
  Original asset, unchanged.
  Article: https://www.techinsights.com/blog/discover-b200-blackwell-next-generation-ai-chip-powered-dual-tsmc-silicon-reticles
  Image: https://www.techinsights.com/sites/default/files/2024-04/NVIDIA-B200%20Blackwell-gpu.png

Other models fall back to the already approved generic exploded GPU artwork
`agent-compute.webp`. Images use empty alt text because the model name is adjacent.

## Transparent derivatives

The active `gpu-h100-cutout.png`, `gpu-h200-cutout.png`, `gpu-b200-cutout.png`,
and `gpu-generic-cutout.png` assets were made from the corresponding source images
using the built-in imagegen background-extraction workflow. They have genuine
alpha transparency. Original source files are retained. The generation prompt
and project file paths are recorded in `docs/GPU_CUTOUTS.md`.
