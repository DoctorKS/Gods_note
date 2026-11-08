let runtime;

function openCV() {
  if (!runtime) {
    importScripts("/opencv-runtime.js");
    const module = self.cv;
    runtime = new Promise((resolve, reject) => {
      // OpenCV's runtime can be a thenable that resolves to itself.
      if (typeof module.then === "function") module.then((cv) => resolve({ cv }), reject);
      else if (module.Mat) resolve({ cv: module });
      else module.onRuntimeInitialized = () => resolve({ cv: module });
    });
  }
  return runtime;
}

function orderCorners(points) {
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
  points.sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
  const topLeft = points.reduce((best, point, index) => point.x + point.y < points[best].x + points[best].y ? index : best, 0);
  return [...points.slice(topLeft), ...points.slice(0, topLeft)];
}

function detect(cv, input) {
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  let bestArea = input.cols * input.rows * 0.16;
  let bestCorners = null;

  function examine(mask) {
    cv.findContours(mask, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let index = 0; index < contours.size(); index++) {
      const contour = contours.get(index);
      const polygon = new cv.Mat();
      try {
        if (cv.contourArea(contour) < bestArea) continue;
        const perimeter = cv.arcLength(contour, true);
        cv.approxPolyDP(contour, polygon, perimeter * 0.025, true);
        if (polygon.rows !== 4 || !cv.isContourConvex(polygon)) continue;
        const area = cv.contourArea(polygon);
        if (area <= bestArea || area > input.cols * input.rows * 0.975) continue;
        const points = Array.from({ length: 4 }, (_, index) => ({
          x: polygon.data32S[index * 2] / (input.cols - 1),
          y: polygon.data32S[index * 2 + 1] / (input.rows - 1),
        }));
        bestArea = area;
        bestCorners = orderCorners(points);
      } finally {
        contour.delete();
        polygon.delete();
      }
    }
  }

  try {
    cv.cvtColor(input, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 35, 110);
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
    examine(edges);
    if (!bestCorners) {
      cv.threshold(gray, edges, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
      examine(edges);
    }
    return bestCorners;
  } finally {
    for (const object of [gray, edges, contours, hierarchy, kernel]) object.delete();
  }
}

function enhance(cv, input, corners) {
  const points = corners.map(({ x, y }) => ({ x: x * (input.cols - 1), y: y * (input.rows - 1) }));
  const length = (a, b) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
  const width = Math.max(2, Math.round(Math.max(length(0, 1), length(3, 2))));
  const height = Math.max(2, Math.round(Math.max(length(0, 3), length(1, 2))));
  const source = cv.matFromArray(4, 1, cv.CV_32FC2, points.flatMap(({ x, y }) => [x, y]));
  const destination = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]);
  const transform = cv.getPerspectiveTransform(source, destination);
  const paper = new cv.Mat();
  const gray = new cv.Mat();
  const soft = new cv.Mat();
  const small = new cv.Mat();
  const lighting = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(9, 9));

  try {
    cv.warpPerspective(input, paper, transform, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    cv.cvtColor(paper, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, soft, new cv.Size(3, 3), 0);
    const scale = Math.min(1, 140 / Math.max(width, height));
    cv.resize(paper, small, new cv.Size(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))), 0, 0, cv.INTER_AREA);
    cv.dilate(small, small, kernel);
    cv.GaussianBlur(small, small, new cv.Size(9, 9), 0);
    cv.resize(small, lighting, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR);

    const pixels = new Uint8ClampedArray(paper.data);
    const light = lighting.data;
    const luma = gray.data;
    const softened = soft.data;
    for (let offset = 0; offset < luma.length; offset++) {
      const sharpness = (luma[offset] - softened[offset]) * 0.65;
      const pixel = offset * 4;
      for (let channel = 0; channel < 3; channel++) {
        const index = pixel + channel;
        pixels[index] = pixels[index] * (249 / Math.max(108, light[index])) + sharpness;
      }
      pixels[pixel + 3] = 255;
    }
    return { width, height, pixels: pixels.buffer };
  } finally {
    for (const object of [source, destination, transform, paper, gray, soft, small, lighting, kernel]) object.delete();
  }
}

self.onmessage = async ({ data }) => {
  let input;
  try {
    const { cv } = await openCV();
    input = cv.matFromImageData(new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height));
    if (data.kind === "detect") {
      self.postMessage({ id: data.id, corners: detect(cv, input) });
    } else {
      const result = enhance(cv, input, data.corners);
      self.postMessage({ id: data.id, ...result }, [result.pixels]);
    }
  } catch {
    self.postMessage({ id: data.id, error: "The scanner could not process this image. Try again or choose another image." });
  } finally {
    input?.delete();
  }
};
