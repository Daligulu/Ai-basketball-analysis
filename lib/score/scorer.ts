export type StrokeMetrics = {
  kneeDepthDeg: number;
  kneeExtendDegPerSec: number;
  releaseAngleDeg: number;
  wristDriveDeg: number;
  followHoldSec: number;
  elbowCompactPct: number;
  alignPct: number;
  stabilityPct?: number;
};

export type ScoreDetail = {
  lowerChain: { depth: number; extend: number; total: number; };
  upperRelease: { angle: number; wrist: number; follow: number; elbowCompact: number; total: number; };
  alignBalance: { balance: number; align: number; total: number; };
  total: number;
};

const clamp01 = (x:number)=> Math.max(0, Math.min(1, x));
const round = (x:number)=> Math.round(x);

function scoreAround(value:number, base:number, spanAbs:number){
  if (!Number.isFinite(value) || !Number.isFinite(base)) return 0;
  const d = Math.abs(value - base);
  return round(100 * (1 - clamp01(d / Math.max(spanAbs, 1e-9))));
}

// 小值更优（如肘部路径紧凑、对齐抖动）：按相对误差/容忍度计分
function scoreSmallerIsBetter(value:number, base:number, relTol:number){
  if (!Number.isFinite(value) || !Number.isFinite(base) || base <= 0) return 0;
  const relErr = Math.abs(value - base) / base;
  const t = relErr / Math.max(relTol, 1e-6);
  return round(100 * (1 - clamp01(t)));
}

export function scoreAngles(coach:any, m:Partial<StrokeMetrics>): ScoreDetail {
  const baseDefault = {
    kneeDepthDeg: 116.36,
    kneeExtendDegPerSec: 121.13,
    releaseAngleDeg: 32.60,
    wristDriveDeg: 0.0,
    followHoldSec: 0.47,
    elbowCompactPct: 0.0003,
    alignPct: 0.0003,
    stabilityPct: 0.0000
  };
  const base = { ...baseDefault, ...(coach?.scoring?.baseline||{}) };

  // 满分跨度（或相对容忍度）
  const span = {
    kneeDepthDeg: 30,
    kneeExtendDegPerSec: 60,
    releaseAngleDeg: 20,
    wristDriveDeg: 30,
    followHoldSec: 0.6,
    elbowCompactRelTol: 0.8,  // 允许±80% 的相对误差仍给一定分
    alignRelTol: 1.0,         // 允许±100%
    balanceRelTol: 1.0
  };

  const v = {
    kneeDepthDeg: Number(m.kneeDepthDeg),
    kneeExtendDegPerSec: Number(m.kneeExtendDegPerSec),
    releaseAngleDeg: Number(m.releaseAngleDeg),
    wristDriveDeg: Number(m.wristDriveDeg),
    followHoldSec: Number(m.followHoldSec),
    elbowCompactPct: Math.abs(Number(m.elbowCompactPct)),
    alignPct: Math.abs(Number(m.alignPct)),
    stabilityPct: Math.abs(Number(m.stabilityPct||0))
  };

  // —— 下肢动力链
  const kneeDepthScore  = scoreAround(v.kneeDepthDeg,  base.kneeDepthDeg,          span.kneeDepthDeg);
  const kneeExtendScore = scoreAround(v.kneeExtendDegPerSec, base.kneeExtendDegPerSec, span.kneeExtendDegPerSec);
  const lowerTotal = round(0.5*kneeDepthScore + 0.5*kneeExtendScore);

  // —— 上肢出手
  const angleScore  = scoreAround(v.releaseAngleDeg, base.releaseAngleDeg, span.releaseAngleDeg);
  const wristScore  = scoreAround(v.wristDriveDeg,   base.wristDriveDeg,   span.wristDriveDeg);
  const followScore = scoreAround(v.followHoldSec,   base.followHoldSec,   span.followHoldSec);
  const elbowCompactScore = scoreSmallerIsBetter(v.elbowCompactPct, base.elbowCompactPct, span.elbowCompactRelTol);
  const upperTotal = round(0.35*angleScore + 0.25*wristScore + 0.15*followScore + 0.25*elbowCompactScore);

  // —— 对齐与平衡（值越小越好）
  const balanceScore = scoreSmallerIsBetter(v.stabilityPct, base.stabilityPct??base.alignPct, span.balanceRelTol);
  const alignScore   = scoreSmallerIsBetter(v.alignPct,     base.alignPct,                     span.alignRelTol);
  const alignTotal   = round(0.6*balanceScore + 0.4*alignScore);

  const total = round(0.4*lowerTotal + 0.35*upperTotal + 0.25*alignTotal);

  return {
    lowerChain:   { depth: kneeDepthScore, extend: kneeExtendScore, total: lowerTotal },
    upperRelease: { angle: angleScore, wrist: wristScore, follow: followScore, elbowCompact: elbowCompactScore, total: upperTotal },
    alignBalance: { balance: balanceScore, align: alignScore, total: alignTotal },
    total
  }
}
