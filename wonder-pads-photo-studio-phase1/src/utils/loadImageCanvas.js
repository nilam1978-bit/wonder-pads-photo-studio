// Turns an uploaded File into a canvas holding its actual pixels, rotated
// upright. "maxDimension" caps the size for a fast, responsive editing
// preview — pass none (or a big number) when you need the real, full-size
// image for a download.
export async function loadImageCanvas(file, maxDimension = null) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

  const scale = maxDimension
    ? Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    : 1;
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return canvas;
}
