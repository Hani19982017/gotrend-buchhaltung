/**
 * Shrinks large photos before upload (phones produce 4–12 MB images).
 * PDFs and images the browser cannot decode (e.g. HEIC on Android) are passed through unchanged.
 */
export async function prepareUpload(file: File, maxEdge = 2400, quality = 0.85): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  if (file.size < 900 * 1024 && file.type !== 'image/png') return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name || 'beleg.jpg', { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  }
}

/** Converts any image (SVG, WebP, PNG, JPG) into a PNG suitable for the invoice logo. */
export async function logoToPng(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('ما قدرت إفتح الصورة'));
      img.src = url;
    });
    const isSvg = file.type.includes('svg');
    const natW = img.naturalWidth || 600;
    const natH = img.naturalHeight || 200;
    const target = isSvg ? 1600 : Math.min(1600, Math.max(natW, natH));
    const scale = target / Math.max(natW, natH);
    const w = Math.max(1, Math.round(natW * scale));
    const h = Math.max(1, Math.round(natH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('ما قدرت حوّل اللوغو');
    return new File([blob], 'logo.png', { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}
