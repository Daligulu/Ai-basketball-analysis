export type Point = { x: number, y: number }
export function angleDeg(a: Point, b: Point, c: Point) {
  const ab = { x: a.x - b.x, y: a.y - b.y }
  const cb = { x: c.x - b.x, y: c.y - b.y }
  const dot = ab.x * cb.x + ab.y * cb.y
  const magAB = Math.hypot(ab.x, ab.y)
  const magCB = Math.hypot(cb.x, cb.y)
  const cos = dot / (magAB * magCB + 1e-6)
  const rad = Math.acos(Math.max(-1, Math.min(1, cos)))
  return rad * 180 / Math.PI
}
export function lerp(a: number, b: number, t: number) { return a + (b - a) * t }
export function avg(xs: number[]) { return xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length) }
