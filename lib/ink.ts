import type { InkPoint, Stroke } from "./models";

export function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number) {
  const { points, tool } = stroke;
  if (!points.length) return;
  const size = Math.min(width, height);
  const coordinates = (point: InkPoint): [number, number] => [point.x * width, point.y * height];
  const thickness = (pressure: number) => size * (0.0022 + pressure * 0.004);
  context.save();
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (tool === "eraser") context.globalCompositeOperation = "destination-out";
  if (tool === "highlighter") context.globalAlpha = 0.32;

  if (tool === "pen" && points.length > 1) {
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1];
      const current = points[index];
      context.beginPath();
      context.lineWidth = thickness((previous.pressure + current.pressure) / 2);
      context.moveTo(...coordinates(previous));
      context.lineTo(...coordinates(current));
      context.stroke();
    }
  } else {
    context.lineWidth = tool === "eraser" ? size * 0.028 : tool === "highlighter" ? size * 0.023 : thickness(points[0].pressure);
    context.beginPath();
    if (points.length === 1) {
      const [x, y] = coordinates(points[0]);
      context.arc(x, y, context.lineWidth / 2, 0, 2 * Math.PI);
      context.fill();
    } else {
      context.moveTo(...coordinates(points[0]));
      for (const point of points.slice(1)) context.lineTo(...coordinates(point));
      context.stroke();
    }
  }
  context.restore();
}
