// Generates a small preview image from an uploaded file, and reports the
// photo's real (full-resolution) dimensions. We keep the ORIGINAL file
// untouched and only ever draw a small copy for the grid — the full-res
// original is what later phases (crop, background removal, export) will
// work from.

const MAX_THUMB_DIMENSION = 480;

export async function createThumbnail(file) {
  // "from-image" tells the browser to bake in the phone's rotation info
  // (EXIF orientation) so sideways phone photos preview upright.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

  const scale = Math.min(1, MAX_THUMB_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const outWidth = Math.round(bitmap.width * scale);
  const outHeight = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, outWidth, outHeight);
  bitmap.close();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));

  return {
    thumbUrl: URL.createObjectURL(blob),
    fullWidth: bitmap.width,
    fullHeight: bitmap.height,
  };
}
