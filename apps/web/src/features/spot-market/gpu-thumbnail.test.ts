import { describe, expect, it } from 'vitest';
import { gpuThumbnailSource } from './components/gpu-thumbnail';

describe('GPU thumbnail model family matching', () => {
  it('selects the matching hardware for common model names and variants', () => {
    expect(gpuThumbnailSource('H100 SXM')).toBe('/terminal-design/gpu-h100-cutout.png');
    expect(gpuThumbnailSource('NVIDIA h100 NVL')).toBe('/terminal-design/gpu-h100-cutout.png');
    expect(gpuThumbnailSource('H200')).toBe('/terminal-design/gpu-h200-cutout.png');
    expect(gpuThumbnailSource('H200 SXM')).toBe('/terminal-design/gpu-h200-cutout.png');
    expect(gpuThumbnailSource('B200')).toBe('/terminal-design/gpu-b200-cutout.png');
  });

  it('uses generic hardware for unknown models instead of mislabeling a different GPU', () => {
    for (const model of ['A100 SXM', 'H1000', 'GB200', '', 'RTX 4090']) {
      expect(gpuThumbnailSource(model)).toBe('/terminal-design/gpu-generic-cutout.png');
    }
  });
});
