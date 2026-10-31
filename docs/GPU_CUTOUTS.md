# Transparent GPU thumbnail assets

Created for the Buyer Terminal using the built-in `image_gen` tool, in edit mode
with `transparent_background: true`. The source hardware images were inspected
before editing. This was background extraction, not a request to redesign hardware.
Original source files and original generated outputs are retained.

## Saved project assets

- `apps/web/public/terminal-design/gpu-h100-cutout.png` — from `gpu-h100.jpg`.
- `apps/web/public/terminal-design/gpu-h200-cutout.png` — from `gpu-h200.jpg` (HGX H200 platform).
- `apps/web/public/terminal-design/gpu-b200-cutout.png` — from `gpu-b200.png`.
- `apps/web/public/terminal-design/gpu-generic-cutout.png` — from `agent-compute.webp`.

All four files have an alpha channel, with alpha values spanning 0–255. The page
uses `object-fit: contain` with no background, border or clipping frame. The hero
continues to use the original artwork; these cutouts are only for thumbnails.

## Exact prompt used once per asset

Use case: background-extraction. Edit target: the provided GPU hardware product image. Produce ONE clean transparent-background product cutout for a small hardware thumbnail in a GPU marketplace. Remove only the black/dark backdrop, ground plane and ground reflections; all space outside the physical hardware and between separated parts must be genuinely transparent alpha, not white, black, gray, or a checkerboard. Preserve the exact hardware subject, materials, perspective, details, colors, and existing markings; do not invent or replace components, do not add text or labels. Keep the whole physical product intact without cropping. Center it in a tight canvas with about 5% transparent padding, subject filling at least 85% of its longest canvas dimension. Clean antialiased edges, no background halo or drop shadow. This is a background-removal edit, not a redesign. Preserve all black physical hardware rather than erasing dark parts.
