import type { PointNM } from "./types";

export const MAX_PUBLIC_RANGE_NM = 120;

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeDeg(value: number) {
  return ((value % 360) + 360) % 360;
}

export function shortAngleDiff(a: number, b: number) {
  return ((normalizeDeg(a) - normalizeDeg(b) + 540) % 360) - 180;
}

export function bearingRangeFromPoint(p: PointNM) {
  const rangeNm = Math.hypot(p.x, p.y);
  const bearingDeg = normalizeDeg((Math.atan2(p.x, p.y) * 180) / Math.PI);
  return { bearingDeg, rangeNm };
}

export function pointFromBearingRange(
  bearingDeg: number,
  rangeNm: number,
): PointNM {
  const a = (bearingDeg * Math.PI) / 180;
  return {
    x: Math.sin(a) * rangeNm,
    y: Math.cos(a) * rangeNm,
  };
}

export function movePoint(
  position: PointNM,
  headingDeg: number,
  distanceNm: number,
): PointNM {
  const delta = pointFromBearingRange(headingDeg, distanceNm);
  return {
    x: position.x + delta.x,
    y: position.y + delta.y,
  };
}

export function nmToScreen(point: PointNM, rangeNm: number, radiusPx: number) {
  const s = radiusPx / rangeNm;
  return { x: point.x * s, y: -point.y * s };
}

export function screenToBearingRange(
  x: number,
  y: number,
  rangeNm: number,
  radiusPx: number,
) {
  const nx = (x / radiusPx) * rangeNm;
  const ny = (-y / radiusPx) * rangeNm;
  return bearingRangeFromPoint({ x: nx, y: ny });
}

export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function padBearing(value: number) {
  return String(Math.round(normalizeDeg(value))).padStart(3, "0");
}

export function isInsideSector(
  bearingDeg: number,
  centerDeg: number,
  widthDeg: number,
) {
  return Math.abs(shortAngleDiff(bearingDeg, centerDeg)) <= widthDeg / 2;
}
