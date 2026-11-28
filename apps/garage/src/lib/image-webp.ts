/**
 * Nén & chuyển đổi hình ảnh sang định dạng WebP ngay trên trình duyệt trước khi tải lên máy chủ / Cloudflare R2.
 * - Tự động thu phóng ảnh camera độ phân giải cao về cạnh dài tối đa (mặc định 1920px) giúp giảm 80–95% dung lượng.
 * - Các file chứng từ không phải ảnh (PDF, CSV, XLSX…) được giữ nguyên.
 */

export interface WebpConvertOptions {
  /** Cạnh dài tối đa tính bằng pixel (mặc định 1920px). */
  maxDimension?: number;
  /** Chất lượng nén WebP từ 0 đến 1 (mặc định 0.82). */
  quality?: number;
}

export function toWebpFilename(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, '').trim() || 'photo';
  return `${base}.webp`;
}

function fitDimensions(srcW: number, srcH: number, maxDim: number): { width: number; height: number } {
  if (srcW <= 0 || srcH <= 0) return { width: 1, height: 1 };
  const longest = Math.max(srcW, srcH);
  if (longest <= maxDim) return { width: srcW, height: srcH };
  const scale = maxDim / longest;
  return {
    width: Math.max(1, Math.round(srcW * scale)),
    height: Math.max(1, Math.round(srcH * scale)),
  };
}

async function decodeImage(
  file: File,
): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file);
    return {
      source: bmp,
      width: bmp.width,
      height: bmp.height,
      cleanup: () => bmp.close(),
    };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Không đọc được file ảnh'));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

export async function convertImageToWebp(file: File, opts: WebpConvertOptions = {}): Promise<File> {
  if (typeof document === 'undefined') return file;
  const isImageMime = file.type.startsWith('image/');
  const isImageExt = /\.(jpe?g|png|webp|bmp|gif|heic|heif|avif)$/i.test(file.name);
  if (!isImageMime && !isImageExt) return file;

  // Ảnh đã ở chuẩn WebP nhỏ gọn (<= 300 KB) thì giữ nguyên dữ liệu gốc để tránh nén lặp
  if (file.type === 'image/webp' && file.size > 0 && file.size <= 300 * 1024) {
    return file.name.toLowerCase().endsWith('.webp')
      ? file
      : new File([file], toWebpFilename(file.name), { type: 'image/webp', lastModified: file.lastModified });
  }

  const maxDimension = opts.maxDimension ?? 1920;
  const quality = opts.quality ?? 0.82;

  let decoded: Awaited<ReturnType<typeof decodeImage>> | null = null;
  try {
    decoded = await decodeImage(file);
    const { width, height } = fitDimensions(decoded.width, decoded.height, maxDimension);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(decoded.source, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/webp', quality);
    });

    if (!blob || blob.type !== 'image/webp' || blob.size === 0) return file;
    return new File([blob], toWebpFilename(file.name), {
      type: 'image/webp',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  } finally {
    decoded?.cleanup();
  }
}
