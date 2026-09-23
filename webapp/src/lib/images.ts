/**
 * A phone photo, made small enough to keep and to post.
 *
 * A receipt snapped at a counter arrives at three or four megabytes, and a
 * month of them would be both slow to upload and too heavy to email — Gmail
 * refuses anything past twenty-five. Scaling the long edge down to something a
 * person can still read the print on, and re-encoding as JPEG, turns that into
 * a few hundred kilobytes without losing a figure.
 *
 * Anything that is not an image, or that the browser cannot decode, is left
 * exactly as it was rather than refused: a PDF from a supplier is still a
 * receipt.
 */
export async function shrinkImage(file: File, maxEdge = 1600, quality = 0.82): Promise<File> {
  if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality)
  );
  // a re-encode that came out larger has done the opposite of its job
  if (!blob || blob.size >= file.size) return file;

  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
}

/** Human-sized, for a line that says how heavy a photograph is. */
export function formatBytes(bytes: number | null | undefined): string {
  const n = bytes ?? 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
