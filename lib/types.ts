export type Landmark = { x: number, y: number, score?: number }
export type Pose = { keypoints: Landmark[] }
export type Hoop = { x: number, y: number, w: number, h: number } | null

export type Shot = {
  id: string
  tStart: number
  tRelease: number | null
  tApex: number | null
  tEnd: number | null
  made: boolean | null
  releaseElbowAngle?: number
  kneeDipAngle?: number
}
