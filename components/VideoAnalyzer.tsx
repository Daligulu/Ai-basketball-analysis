'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as poseDetection from '@tensorflow-models/pose-detection'
import * as tf from '@tensorflow/tfjs-core'
import '@tensorflow/tfjs-converter'
import '@tensorflow/tfjs-backend-webgl'
import { angleDeg } from '@/lib/angles'
import type { Hoop, Shot } from '@/lib/types'

type KP = { x: number, y: number, score?: number, name?: string }

const KP_NAMES = {
  nose: 0, leftEye: 1, rightEye: 2, leftEar: 3, rightEar: 4,
  leftShoulder: 5, rightShoulder: 6, leftElbow: 7, rightElbow: 8,
  leftWrist: 9, rightWrist: 10, leftHip: 11, rightHip: 12,
  leftKnee: 13, rightKnee: 14, leftAnkle: 15, rightAnkle: 16
}

type Ball = { x: number, y: number, r: number, ok: boolean }
type State = 'idle' | 'tracking' | 'released'

async function createDetectorWithFallback() {
  // 1) webgl backend
  try {
    await tf.setBackend('webgl')
    await tf.ready()
  } catch (_) {
    // ignore, we'll try wasm below
  }
  // 2) Try MoveNet first (may fail in部分地区因 tfhub 访问)
  try {
    const det = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: 'lightning',
    } as any)
    return { det, note: 'MoveNet ✔︎' }
  } catch (e) {
    console.warn('MoveNet load failed, fallback to BlazePose', e)
  }
  // 3) Fallback: BlazePose via Mediapipe CDN (一般在国内也可访问 jsDelivr)
  try {
    const det = await poseDetection.createDetector(poseDetection.SupportedModels.BlazePose, {
      runtime: 'mediapipe',
      modelType: 'lite',
      solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose'
    } as any)
    return { det, note: '已切换为 BlazePose ✔︎' }
  } catch (e) {
    console.warn('BlazePose load failed, fallback to WASM MoveNet', e)
  }
  // 4) Last resort: WASM backend + MoveNet (指定 wasm CDN 路径)
  try {
    const wasm = await import('@tensorflow/tfjs-backend-wasm')
    ;(wasm as any).setWasmPaths?.('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.19.0/dist/')
    await tf.setBackend('wasm')
    await tf.ready()
    const det = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: 'lightning',
    } as any)
    return { det, note: '使用 WASM 后端 ✔︎' }
  } catch (e) {
    console.error('All detectors failed', e)
    throw e
  }
}

export default function VideoAnalyzer() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hudRef = useRef<HTMLCanvasElement | null>(null)
  const [detector, setDetector] = useState<poseDetection.PoseDetector | null>(null)
  const [ready, setReady] = useState(false)
  const [running, setRunning] = useState(false)
  const [hoop, setHoop] = useState<Hoop>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [state, setState] = useState<State>('idle')
  const [ballTrace, setBallTrace] = useState<{x:number,y:number}[]>([])
  const raf = useRef<number | null>(null)
  const [msg, setMsg] = useState('')

  // Init detector with fallbacks
  useEffect(() => {
    (async () => {
      try {
        const { det, note } = await createDetectorWithFallback()
        setDetector(det)
        setMsg(note)
      } catch (e) {
        setMsg('模型加载失败：网络或 CDN 访问受限。可尝试切换网络后刷新。')
      }
    })()
  }, [])

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    const v = videoRef.current!
    v.src = url
    v.onloadedmetadata = () => {
      v.width = v.videoWidth
      v.height = v.videoHeight
      canvasRef.current!.width = v.videoWidth
      canvasRef.current!.height = v.videoHeight
      hudRef.current!.width = v.videoWidth
      hudRef.current!.height = v.videoHeight
      setReady(true)
    }
  }, [])

  const start = useCallback(() => {
    if (!detector || !ready) return
    setRunning(true)
    setMsg('')
    loop()
  }, [detector, ready])

  const stop = useCallback(() => {
    setRunning(false)
    if (raf.current) cancelAnimationFrame(raf.current)
  }, [])

  const drawPose = (ctx: CanvasRenderingContext2D, kps: KP[]) => {
    ctx.save()
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(34,211,238,0.9)'
    ctx.fillStyle = 'rgba(34,211,238,0.9)'
    const pairs: [number, number][] = [
      [KP_NAMES.leftShoulder, KP_NAMES.rightShoulder],
      [KP_NAMES.leftHip, KP_NAMES.rightHip],
      [KP_NAMES.leftShoulder, KP_NAMES.leftElbow],
      [KP_NAMES.leftElbow, KP_NAMES.leftWrist],
      [KP_NAMES.rightShoulder, KP_NAMES.rightElbow],
      [KP_NAMES.rightElbow, KP_NAMES.rightWrist],
      [KP_NAMES.leftHip, KP_NAMES.leftKnee],
      [KP_NAMES.leftKnee, KP_NAMES.leftAnkle],
      [KP_NAMES.rightHip, KP_NAMES.rightKnee],
      [KP_NAMES.rightKnee, KP_NAMES.rightAnkle],
      [KP_NAMES.leftShoulder, KP_NAMES.leftHip],
      [KP_NAMES.rightShoulder, KP_NAMES.rightHip],
    ]
    for (const [a,b] of pairs) {
      const p1 = kps[a], p2 = kps[b]
      if (p1?.score && p2?.score && p1.score>0.3 && p2.score>0.3) {
        ctx.beginPath()
        ctx.moveTo(p1.x, p1.y)
        ctx.lineTo(p2.x, p2.y)
        ctx.stroke()
      }
    }
    kps.forEach(k => {
      if (k?.score && k.score > 0.3) {
        ctx.beginPath()
        ctx.arc(k.x, k.y, 4, 0, Math.PI*2)
        ctx.fill()
      }
    })
    ctx.restore()
  }

  const detectBall = (ctx: CanvasRenderingContext2D): Ball => {
    const { width, height } = ctx.canvas
    const img = ctx.getImageData(0, 0, width, height)
    let sx=0, sy=0, n=0
    for (let i=0; i<img.data.length; i+=4) {
      const r=img.data[i], g=img.data[i+1], b=img.data[i+2]
      if (r>150 && g>70 && g<180 && b<120 && (r-g)>30 && (g-b)>10) {
        const idx = (i/4)
        const x = idx % width
        const y = Math.floor(idx / width)
        sx+=x; sy+=y; n++
      }
    }
    if (n<50) return { x:0,y:0,r:0,ok:false }
    const cx = sx/n, cy = sy/n
    return { x: cx, y: cy, r: 10, ok: true }
  }

  const latest = useRef<{kps: KP[]|null, ball: Ball|null, lastBallY: number|null, releaseDetected: boolean}>({kps:null, ball:null, lastBallY:null, releaseDetected:false})
  const currentShot = useRef<Shot | null>(null)

  const logic = (kps: KP[]|null, ball: Ball|null, t: number) => {
    const leftElbow = kps?.[KP_NAMES.leftElbow]; const leftShoulder = kps?.[KP_NAMES.leftShoulder]; const leftWrist = kps?.[KP_NAMES.leftWrist]
    const rightElbow = kps?.[KP_NAMES.rightElbow]; const rightShoulder = kps?.[KP_NAMES.rightShoulder]; const rightWrist = kps?.[KP_NAMES.rightWrist]
    const leftKnee = kps?.[KP_NAMES.leftKnee]; const leftHip = kps?.[KP_NAMES.leftHip]; const rightKnee = kps?.[KP_NAMES.rightKnee]; const rightHip = kps?.[KP_NAMES.rightHip]

    const elbowAngleLeft = (leftElbow&&leftShoulder&&leftWrist)? angleDeg(leftShoulder,leftElbow,leftWrist) : null
    const elbowAngleRight = (rightElbow&&rightShoulder&&rightWrist)? angleDeg(rightShoulder,rightElbow,rightWrist) : null
    const kneeAngleLeft = (leftHip&&leftKnee&&kps?.[KP_NAMES.leftAnkle])? angleDeg(leftHip,leftKnee,kps[KP_NAMES.leftAnkle]) : null
    const kneeAngleRight = (rightHip&&rightKnee&&kps?.[KP_NAMES.rightAnkle])? angleDeg(rightHip,rightKnee,kps[KP_NAMES.rightAnkle]) : null

    const elbowAngle = elbowAngleRight ?? elbowAngleLeft ?? null
    const kneeAngle = Math.min(kneeAngleLeft ?? 180, kneeAngleRight ?? 180)

    const wristsBelowShoulders = (leftWrist && leftShoulder && leftWrist.y > leftShoulder.y) || (rightWrist && rightShoulder && rightWrist.y > rightShoulder.y)
    if (!currentShot.current && kneeAngle < 165 && wristsBelowShoulders) {
      currentShot.current = { id: `shot-${Date.now()}`, tStart: t, tRelease: null, tApex: null, tEnd: null, made: null, kneeDipAngle: kneeAngle ?? undefined }
      setState('tracking')
    }

    if (currentShot.current && !currentShot.current.tRelease && elbowAngle && elbowAngle > 165 && ((rightWrist && rightShoulder && rightWrist.y < rightShoulder.y) || (leftWrist && leftShoulder && leftWrist.y < leftShoulder.y))) {
      currentShot.current.tRelease = t
      currentShot.current.releaseElbowAngle = elbowAngle
      setState('released')
    }

    if (currentShot.current && currentShot.current.tRelease && hoop && ball?.ok) {
      const fromAbove = ball.y < hoop.y + 0.3 * hoop.h
      const inside = ball.x > hoop.x && ball.x < hoop.x + hoop.w && ball.y > hoop.y && ball.y < hoop.y + hoop.h
      if (fromAbove && inside) {
        currentShot.current.made = true
        currentShot.current.tEnd = t
        setShots(prev => [...prev, currentShot.current!])
        currentShot.current = null
        setState('idle')
      }
    }

    if (currentShot.current && currentShot.current.tRelease && t - currentShot.current.tRelease > 2.0) {
      if (ball?.ok && hoop && ball.y > hoop.y + hoop.h + 15) {
        currentShot.current.made = false
        currentShot.current.tEnd = t
        setShots(prev => [...prev, currentShot.current!])
        currentShot.current = null
        setState('idle')
      }
    }
  }

  const loop = useCallback(async () => {
    const v = videoRef.current!, canvas = canvasRef.current!, hud = hudRef.current!
    const ctx = canvas.getContext('2d')!, hctx = hud.getContext('2d')!
    const t0 = performance.now()
    const tick = async () => {
      if (!running || !detector) { return }
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
      const poses = await detector.estimatePoses(v)
      const kps: KP[] = poses?.[0]?.keypoints?.map((k: any) => ({ x: k.x, y: k.y, score: k.score })) ?? []
      const ball = detectBall(ctx)
      if (ball.ok) setBallTrace(prev => (prev.concat([{x: ball.x, y: ball.y}]).slice(-60)))
      const t = (performance.now() - t0) / 1000
      logic(kps, ball, t)
      hctx.clearRect(0,0,hud.width,hud.height)
      if (kps.length) drawPose(hctx, kps)
      if (ball?.ok) {
        hctx.strokeStyle = 'rgba(34,211,238,0.9)'; hctx.fillStyle = 'rgba(34,211,238,0.9)'
        hctx.beginPath(); hctx.arc(ball.x, ball.y, 8, 0, Math.PI*2); hctx.stroke()
        hctx.beginPath()
        for (let i=0;i<ballTrace.length;i++) { const p = ballTrace[i]; if (i===0) hctx.moveTo(p.x, p.y); else hctx.lineTo(p.x, p.y) }
        hctx.stroke()
      }
      if (hoop) {
        hctx.strokeStyle = 'rgba(255,255,255,0.9)'
        hctx.lineWidth = 2
        hctx.strokeRect(hoop.x, hoop.y, hoop.w, hoop.h)
        hctx.font = '12px sans-serif'; hctx.fillStyle = 'white'
        hctx.fillText('Hoop ROI', hoop.x+4, hoop.y+14)
      }
      raf.current = requestAnimationFrame(tick as any)
    }
    raf.current = requestAnimationFrame(tick as any)
  }, [detector, running, hoop, ballTrace])

  const dragging = useRef<{x:number,y:number}|null>(null)
  const onHudDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setHoop({ x, y, w: 120, h: 70 })
    dragging.current = { x, y }
  }
  const onHudMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging.current) return
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    setHoop(h => h ? ({ ...h, w: x - h.x, h: y - h.y }) : h)
  }
  const onHudUp = () => dragging.current = null

  const onPlay = () => { if (!running) start() }
  const onPause = () => { stop() }

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center gap-3">
          <input type="file" accept="video/*" onChange={onFile} className="block w-full text-sm text-slate-300" />
          <button className="btn-outline" onClick={() => {
            const v = videoRef.current!
            v.muted = true
            navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
              v.srcObject = stream as any
              v.onloadedmetadata = () => {
                v.play()
                v.width = v.videoWidth; v.height = v.videoHeight
                canvasRef.current!.width = v.videoWidth; canvasRef.current!.height = v.videoHeight
                hudRef.current!.width = v.videoWidth; hudRef.current!.height = v.videoHeight
                setReady(true)
              }
            })
          }}>使用摄像头</button>
        </div>
        <div className="relative">
          <video ref={videoRef} className="w-full rounded border border-slate-700 bg-black" controls onPlay={onPlay} onPause={onPause} playsInline />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          <canvas ref={hudRef} className="absolute inset-0 w-full h-full" onMouseDown={onHudDown} onMouseMove={onHudMove} onMouseUp={onHudUp} />
        </div>
        <div className="flex gap-3">
          <button className="btn" disabled={!ready || !detector} onClick={start}>开始</button>
          <button className="btn-outline" onClick={stop}>停止</button>
          <span className="text-slate-400 text-sm">{msg || (detector ? '模型已加载 ✔︎' : '正在加载模型…')}</span>
        </div>
        <p className="text-slate-400 text-xs">小技巧：先在画面上<strong>拖拽绘制篮筐区域</strong>（白框），再播放视频或开始录制。</p>
      </div>

      <aside className="space-y-4">
        <div className="card">
          <h3 className="text-lg font-medium mb-2">统计</h3>
          <ul className="text-slate-300 text-sm space-y-1">
            <li>总出手：<b>{shots.length}</b></li>
            <li>命中：<b>{shots.filter(s => s.made).length}</b></li>
            <li>命中率：<b>{shots.length ? Math.round(100*shots.filter(s=>s.made).length/shots.length) : 0}%</b></li>
          </ul>
          <button className="btn-outline mt-3" onClick={() => {
            const blob = new Blob([JSON.stringify(shots, null, 2)], { type: 'application/json' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = 'shots.json'
            a.click()
          }}>导出 JSON</button>
        </div>
        <div className="card">
          <h3 className="text-lg font-medium mb-2">最近出手</h3>
          <div className="space-y-2 max-h-[320px] overflow-auto pr-2">
            {shots.slice().reverse().map((s) => (
              <div key={s.id} className="text-sm border border-slate-700 rounded p-2">
                <div className="flex justify-between">
                  <span>#{s.id.slice(-6)}</span>
                  <span className={s.made ? 'text-emerald-400' : 'text-rose-400'}>{s.made ? '命中' : '未进'}</span>
                </div>
                <div className="text-slate-400 text-xs mt-1">
                  释放肘角: {s.releaseElbowAngle?.toFixed(1) ?? '-'}°， 膝盖下蹲角: {s.kneeDipAngle?.toFixed(1) ?? '-'}°
                </div>
              </div>
            ))}
            {!shots.length && <p className="text-slate-400 text-sm">暂时没有数据</p>}
          </div>
        </div>
        <div className="card">
          <h3 className="text-lg font-medium mb-2">说明</h3>
          <p className="text-slate-400 text-sm">若模型加载失败，通常是 CDN 在本地网络不可达。我已内置多重回退：MoveNet → BlazePose(Mediapipe CDN) → TFJS WASM。仍失败请更换网络或告知我把模型文件内置本仓库。
          </p>
        </div>
      </aside>
    </div>
  )
}
