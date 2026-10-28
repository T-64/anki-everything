const MAX_EDGE = 2000;
/** 长截图（如 Kaufland App 里的电子小票）按长边缩会把字缩没：至少保留这么宽 */
const MIN_TALL_WIDTH = 1000;
const MAX_TALL_HEIGHT = 8000;
/** 和服务端的上限一致（3MB，base64 后约 4MB） */
const MAX_DATA_URL = 3 * 1024 * 1024 * 1.33;

/**
 * 压缩后的尺寸。普通照片：长边 2000px 足够 GLM 识别。
 * 长截图（高是宽的 2.5 倍以上）：宽度保住 1000px（原图更窄就不放大），高度最多 8000px。
 */
export function targetSize(width: number, height: number): { width: number; height: number } {
  let scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  if (height / width > 2.5) {
    scale = Math.min(1, Math.max(scale, MIN_TALL_WIDTH / width), MAX_TALL_HEIGHT / height);
  }
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** 照片或截图 → JPEG data URL（base64 在手机上做，Worker 不用再算）。超过上限就降低质量再压。 */
export async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const size = targetSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d")!;
  // 截图可能是透明 PNG：先铺白底，JPEG 里透明会变黑
  context.fillStyle = "#fff";
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  let dataUrl = "";
  for (const quality of [0.82, 0.7, 0.55]) {
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= MAX_DATA_URL) break;
  }
  return dataUrl;
}

const THUMB_EDGE = 560;

/** 照片墙用的小图：长边 560px，JPEG。从已压缩的 data URL 生成 */
export async function makeThumb(dataUrl: string): Promise<string> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const scale = Math.min(1, THUMB_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}
