"use client";

import { useLayoutEffect, useRef, useState } from "react";

type Point = { x: number; y: number };
type TouchPointer = { pointerId: number; clientX: number; clientY: number };
type ZoomAnchor = { page: Point; screen: Point };

const MAX_ZOOM = 3;
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const pointerPoint = (pointer: TouchPointer) => ({ x: pointer.clientX, y: pointer.clientY });

export function usePaperViewport() {
  const stageRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const touches = useRef(new Map<number, Point>());
  const navigating = useRef(false);
  const zoomRef = useRef(1);
  const anchor = useRef<ZoomAnchor | null>(null);
  const [zoom, setZoom] = useState(1);

  function pan(from: Point, to: Point) {
    const stage = stageRef.current;
    if (!stage) return;
    stage.scrollLeft += from.x - to.x;
    stage.scrollTop += from.y - to.y;
  }

  function zoomAround(value: number, from: Point, to: Point) {
    const next = Math.min(MAX_ZOOM, Math.max(1, value));
    const rect = paperRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height || Math.abs(next - zoomRef.current) < 0.0001) {
      pan(from, to);
      return;
    }
    anchor.current = {
      page: { x: (from.x - rect.left) / rect.width, y: (from.y - rect.top) / rect.height },
      screen: to,
    };
    zoomRef.current = next;
    setZoom(next);
  }

  useLayoutEffect(() => {
    const pending = anchor.current;
    const rect = paperRef.current?.getBoundingClientRect();
    const stage = stageRef.current;
    if (!pending || !rect || !stage) return;
    anchor.current = null;
    stage.scrollLeft += rect.left + rect.width * pending.page.x - pending.screen.x;
    stage.scrollTop += rect.top + rect.height * pending.page.y - pending.screen.y;
  }, [zoom]);

  function zoomBy(factor: number) {
    const viewport = stageRef.current?.getBoundingClientRect();
    const paper = paperRef.current?.getBoundingClientRect();
    if (!viewport || !paper) return;
    const point = {
      x: Math.max(paper.left, Math.min(paper.right, viewport.left + viewport.width / 2)),
      y: Math.max(paper.top, Math.min(paper.bottom, viewport.top + viewport.height / 2)),
    };
    zoomAround(zoomRef.current * factor, point, point);
  }

  function fit() {
    anchor.current = null;
    zoomRef.current = 1;
    setZoom(1);
    stageRef.current?.scrollTo(0, 0);
  }

  function beginTouch(pointer: TouchPointer, pencilOnly: boolean) {
    touches.current.set(pointer.pointerId, pointerPoint(pointer));
    // A two-finger gesture also takes over when finger drawing is enabled.
    navigating.current ||= pencilOnly || touches.current.size > 1;
    return navigating.current;
  }

  function moveTouch(pointer: TouchPointer) {
    const previous = touches.current.get(pointer.pointerId);
    if (!previous) return false;
    const [first, second] = touches.current.values();
    const next = pointerPoint(pointer);
    touches.current.set(pointer.pointerId, next);
    if (!navigating.current) return false;
    if (!second) {
      pan(previous, next);
    } else {
      const [newFirst, newSecond] = touches.current.values();
      const before = distance(first, second);
      const factor = before > 0 ? distance(newFirst, newSecond) / before : 1;
      zoomAround(zoomRef.current * factor, midpoint(first, second), midpoint(newFirst, newSecond));
    }
    return true;
  }

  function endTouch(pointer: TouchPointer) {
    const handled = touches.current.delete(pointer.pointerId) && navigating.current;
    if (!touches.current.size) navigating.current = false;
    return handled;
  }

  function clearTouches() {
    touches.current.clear();
    navigating.current = false;
  }

  return { stageRef, paperRef, zoom, canZoomIn: zoom < MAX_ZOOM, zoomBy, fit, beginTouch, moveTouch, endTouch, clearTouches };
}
