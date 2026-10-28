/** 裁剪框，用占原图宽高的比例表示（0–1），和显示尺寸无关 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 两个点拖出的框，限制在图片范围内；太小（误触）返回 null */
export function rectFrom(start: { x: number; y: number }, end: { x: number; y: number }): CropRect | null {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const x1 = clamp(Math.min(start.x, end.x));
  const y1 = clamp(Math.min(start.y, end.y));
  const x2 = clamp(Math.max(start.x, end.x));
  const y2 = clamp(Math.max(start.y, end.y));
  if (x2 - x1 < 0.05 || y2 - y1 < 0.05) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** 按裁剪框切出 JPEG data URL */
export async function cropImage(dataUrl: string, rect: CropRect): Promise<string> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const sx = Math.round(rect.x * image.naturalWidth);
  const sy = Math.round(rect.y * image.naturalHeight);
  const width = Math.round(rect.width * image.naturalWidth);
  const height = Math.round(rect.height * image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(image, sx, sy, width, height, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.85);
}
