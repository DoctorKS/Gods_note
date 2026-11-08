import { MAX_UPLOAD_BYTES } from "./models";

export type Point = { x: number; y: number };
export type Corners = [Point, Point, Point, Point];

export type PreparedImage = { original: Blob; ratio: number; corners: Corners | null };
export type Scan = { image: Blob; thumbnail: Blob; ratio: number };

export const FULL_IMAGE: Corners = [{ x: 0.02, y: 0.02 }, { x: 0.98, y: 0.02 }, { x: 0.98, y: 0.98 }, { x: 0.02, y: 0.98 }];

type ScanResponse = { id: number; error?: string; corners?: Corners | null; pixels?: ArrayBuffer; width?: number; height?: number };
type Job = { resolve: (result: ScanResponse) => void; reject: (error: Error) => void; timer: number };
let worker: Worker | undefined;
let nextId = 0;
const jobs = new Map<number, Job>();

function stopWorker(error: Error) {
  worker?.terminate();
  worker = undefined;
  for (const job of jobs.values()) {
    window.clearTimeout(job.timer);
    job.reject(error);
  }
  jobs.clear();
}

function processImage(kind: "detect" | "enhance", image: ImageData, corners?: Corners) {
  if (!worker) {
    worker = new Worker("/scanner-worker.js");
    worker.onmessage = ({ data }: MessageEvent<ScanResponse>) => {
      const job = jobs.get(data.id);
      if (!job) return;
      jobs.delete(data.id);
      window.clearTimeout(job.timer);
      if (data.error) job.reject(new Error(data.error));
      else job.resolve(data);
    };
    worker.onerror = () => stopWorker(new Error("Could not start the document scanner."));
  }
  return new Promise<ScanResponse>((resolve, reject) => {
    const id = nextId++;
    const timer = window.setTimeout(() => stopWorker(new Error("The scanner timed out. Try again.")), 45_000);
    jobs.set(id, { resolve, reject, timer });
    const pixels = image.data.buffer as ArrayBuffer;
    worker?.postMessage({ id, kind, width: image.width, height: image.height, pixels, corners }, [pixels]);
  });
}

function canvasAt(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function context2d(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Your browser could not open the image canvas.");
  return context;
}

async function loadImage(blob: Blob, maxSize: number) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); }
    catch { throw new Error("This image could not be opened. Try a JPEG or PNG."); }
    const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = canvasAt(image.naturalWidth * scale, image.naturalHeight * scale);
    if (Math.min(canvas.width, canvas.height) < 24) throw new Error("This image is too small to scan.");
    const context = context2d(canvas);
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function jpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error("Could not create the scan preview."));
  }, "image/jpeg", quality));
}

async function jpegForUpload(canvas: HTMLCanvasElement, preferredQuality: number) {
  let source = canvas;
  while (true) {
    for (const quality of [preferredQuality, 0.82, 0.72]) {
      const blob = await jpeg(source, quality);
      if (blob.size <= MAX_UPLOAD_BYTES) return { blob, ratio: source.width / source.height };
    }
    if (source.width === 1 && source.height === 1) throw new Error("Could not compress the scan to 400 KB.");
    const smaller = canvasAt(Math.floor(source.width * 0.8), Math.floor(source.height * 0.8));
    context2d(smaller).drawImage(source, 0, 0, smaller.width, smaller.height);
    source = smaller;
  }
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const canvas = await loadImage(file, 1800);
  const scale = Math.min(1, 760 / Math.max(canvas.width, canvas.height));
  const small = canvasAt(canvas.width * scale, canvas.height * scale);
  const context = context2d(small);
  context.drawImage(canvas, 0, 0, small.width, small.height);
  const [original, result] = await Promise.all([
    jpeg(canvas, 0.94),
    processImage("detect", context.getImageData(0, 0, small.width, small.height)),
  ]);
  return { original, ratio: canvas.width / canvas.height, corners: result.corners ?? null };
}

export function isValidCrop(corners: Corners) {
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return corners.every((point, index) => cross(point, corners[(index + 1) % 4], corners[(index + 2) % 4]) > 0.008);
}

export async function scanImage(original: Blob, corners: Corners): Promise<Scan> {
  if (!isValidCrop(corners)) throw new Error("Keep the four corners in order around the page.");
  const source = await loadImage(original, 1800);
  const result = await processImage("enhance", context2d(source).getImageData(0, 0, source.width, source.height), corners);
  if (!result.pixels || !result.width || !result.height) throw new Error("The scan did not produce an image.");
  const full = canvasAt(result.width, result.height);
  context2d(full).putImageData(new ImageData(new Uint8ClampedArray(result.pixels), result.width, result.height), 0, 0);
  const scale = Math.min(1, 360 / Math.max(full.width, full.height));
  const cover = canvasAt(full.width * scale, full.height * scale);
  context2d(cover).drawImage(full, 0, 0, cover.width, cover.height);
  const [image, thumbnail] = await Promise.all([jpegForUpload(full, 0.92), jpegForUpload(cover, 0.87)]);
  return { image: image.blob, thumbnail: thumbnail.blob, ratio: image.ratio };
}
