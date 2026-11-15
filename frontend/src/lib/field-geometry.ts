export type LonLat = [number, number];

function orientation(a: LonLat, b: LonLat, c: LonLat): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: LonLat, b: LonLat, p: LonLat): boolean {
  return Math.abs(orientation(a, b, p)) < 1e-12 &&
    p[0] >= Math.min(a[0], b[0]) - 1e-12 &&
    p[0] <= Math.max(a[0], b[0]) + 1e-12 &&
    p[1] >= Math.min(a[1], b[1]) - 1e-12 &&
    p[1] <= Math.max(a[1], b[1]) + 1e-12;
}

function segmentsIntersect(a: LonLat, b: LonLat, c: LonLat, d: LonLat): boolean {
  const o1 = orientation(a, b, c), o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a), o4 = orientation(c, d, b);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
      ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true;
  return (Math.abs(o1) < 1e-12 && onSegment(a, b, c)) ||
    (Math.abs(o2) < 1e-12 && onSegment(a, b, d)) ||
    (Math.abs(o3) < 1e-12 && onSegment(c, d, a)) ||
    (Math.abs(o4) < 1e-12 && onSegment(c, d, b));
}

/** Checks non-adjacent polygon edges; input ring may be open or closed. */
export function polygonSelfIntersects(points: readonly LonLat[]): boolean {
  const ring = points.length > 1 &&
    points[0][0] === points[points.length - 1][0] &&
    points[0][1] === points[points.length - 1][1]
    ? points.slice(0, -1) : points;
  if (ring.length < 4) return false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    for (let j = i + 1; j < ring.length; j++) {
      if (j === i || j === (i + 1) % ring.length || (j + 1) % ring.length === i) continue;
      if (segmentsIntersect(a, b, ring[j], ring[(j + 1) % ring.length])) return true;
    }
  }
  return false;
}

/** Ray-casting point-in-ring; polygon coordinates are [longitude, latitude]. */
export function pointInRing(point: LonLat, ring: readonly LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (onSegment([xi, yi], [xj, yj], point)) return true;
    const crosses = (yi > point[1]) !== (yj > point[1]) &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** A point is inside Nepal when covered by at least one loaded district polygon. */
export function pointInDistricts(
  point: LonLat,
  geometries: readonly ({ type: "Polygon" | "MultiPolygon"; coordinates: unknown })[],
): boolean {
  for (const geometry of geometries) {
    const polygons = geometry.type === "Polygon"
      ? [geometry.coordinates as LonLat[][]]
      : geometry.coordinates as LonLat[][][];
    for (const polygon of polygons) {
      if (polygon[0] && pointInRing(point, polygon[0]) &&
          !polygon.slice(1).some((hole) => pointInRing(point, hole))) return true;
    }
  }
  return false;
}
