import Image from 'next/image';
import '../gpu-thumbnails.css';

/** Family artwork identifies the model; listing specs still describe the actual offer. */
export function gpuThumbnailSource(model: string) {
  if (/\bH100\b/i.test(model)) return '/terminal-design/gpu-h100-cutout.png';
  if (/\bH200\b/i.test(model)) return '/terminal-design/gpu-h200-cutout.png';
  if (/\bB200\b/i.test(model)) return '/terminal-design/gpu-b200-cutout.png';
  return '/terminal-design/gpu-generic-cutout.png';
}

export function GpuThumbnail({ model }: { model: string }) {
  return (
    <span className="buyer-gpu-thumbnail" aria-hidden="true">
      <Image src={gpuThumbnailSource(model)} alt="" width={144} height={112} sizes="72px" />
    </span>
  );
}
