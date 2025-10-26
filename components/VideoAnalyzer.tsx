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
  try { await tf.setBackend('webgl'); await tf.ready() } catch (_) {}
  try {
    const det = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, { modelType: 'lightning' } as any)
    return { det, note: 'MoveNet ✔︎' }
  } catch (e) { console.warn('MoveNet load failed, fallback to BlazePose', e) }
  try {
    const det = await poseDetection.createDetector(poseDetection.SupportedModels.BlazePose, { runtime: 'mediapipe', modelType: 'lite', solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose' } as any)
    return { det, note: '已切换为 BlazePose ✔︎' }
  } catch (e) { console.warn('BlazePose load failed, fallback to WASM MoveNet', e) }
  try {
    const wasm = await import('@tensorflow/tfjs-backend-wasm')
    ;(wasm as any).setWasmPaths?.('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.19.0/dist/')
    await tf.setBackend('wasm'); await tf.ready()
    const det = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, { modelType: 'lightning' } as any)
    return { det, note: '使用 WASM 后端 ✔︎' }
  } catch (e) { console.error('All detectors failed', e); throw e }
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
  const [msg, setMsg] = useState('')

  // realtime flags via refs to avoid stale closures
  const runningRef = useRef(false)
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null)
  const raf = useRef<number | null>(null)

  useEffect(() => { runningRef.current = running }, [running])
  useEffect(() => { detectorRef.current = detector }, [detector])

  // Init detector with fallbacks
  useEffect(() => {
    (async () => {
      try { const { det, note } = await createDetectorWithFallback(); setDetector(det); setMsg(note) }
      catch { setMsg('模型加载失败：网络或 CDN 受限。请更换网络或刷新。') }
    })()
  }, [])

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const url = URL.createObjectURL(file)
    const v = videoRef.current!
    v.crossOrigin = 'anonymous'
    v.src = url
    v.onloadedmetadata = () => {
      v.width = v.videoWidth; v.height = v.videoHeight
      const cw = canvasRef.current!, hw = hudRef.current!
      cw.width = v.videoWidth; cw.height = v.videoHeight
      hw.width = v.videoWidth; hw.height = v.videoHeight
      setReady(true)
    }
  }, [])

  const ensureLoop = useCallback(() => {
    if (raf.current == null) {
      const tick = async () => {
        try {
          const v = videoRef.current, det = detectorRef.current, canvas = canvasRef.current, hud = hudRef.current
          if (!v || !canvas || !hud) { raf.current = requestAnimationFrame(tick); return }
          // always keep RAF alive; skip heavy work when not running
          if (!runningRef.current || !det) { raf.current = requestAnimationFrame(tick); return }
          if (v.readyState < 2) { raf.current = requestAnimationFrame(tick); return }

          const ctx = canvas.getContext('2d')!
          const hctx = hud.getContext('2d')!
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height)

          const poses = await det.estimatePoses(v)
          const kps: KP[] = (poses?.[0]?.keypoints ?? []).map((k: any) => ({ x:k.x, y:k.y, score:k.score }))

          // ball detection (simple color threshold)
          let ball: Ball | null = null
          try {
            const img = ctx.getImageData(0,0,canvas.width,canvas.height)
            let sx=0, sy=0, n=0
            for (let i=0;i<img.data.length;i+=4){ const r=img.data[i],g=img.data[i+1],b=img.data[i+2]; if (r>150 && g>70 && g<180 && b<120 && (r-g)>30 && (g-b)>10){ const idx=i/4; const x=idx%canvas.width; const y=Math.floor(idx/canvas.width); sx+=x; sy+=y; n++ } }
            if (n>=50) ball = { x:sx/n, y:sy/n, r:10, ok:true }
          } catch {}

          // update HUD
          hctx.clearRect(0,0,hud.width,hud.height)
          if (kps.length){
            hctx.save(); hctx.lineWidth=3; hctx.strokeStyle='rgba(34,211,238,0.9)'; hctx.fillStyle='rgba(34,211,238,0.9)'
            const pairs: [number, number][] = [[5,6],[11,12],[5,7],[7,9],[6,8],[8,10],[11,13],[13,15],[12,14],[14,16],[5,11],[6,12]]
            for (const [a,b] of pairs){ const p1:any=kps[a], p2:any=kps[b]; if (p1?.score>0.3 && p2?.score>0.3){ hctx.beginPath(); hctx.moveTo(p1.x,p1.y); hctx.lineTo(p2.x,p2.y); hctx.stroke() } }
            kps.forEach((k:any)=>{ if(k?.score>0.3){ hctx.beginPath(); hctx.arc(k.x,k.y,4,0,Math.PI*2); hctx.fill() } })
            hctx.restore()
          }
          if (ball?.ok){ hctx.strokeStyle='rgba(34,211,238,0.9)'; hctx.beginPath(); hctx.arc(ball.x,ball.y,8,0,Math.PI*2); hctx.stroke() }
          if (hoop){ hctx.strokeStyle='rgba(255,255,255,0.9)'; hctx.lineWidth=2; hctx.strokeRect(hoop.x,hoop.y,hoop.w,hoop.h); hctx.font='12px sans-serif'; hctx.fillStyle='white'; hctx.fillText('Hoop ROI', hoop.x+4, hoop.y+14) }
        } catch { /* ignore frame errors */ }
        raf.current = requestAnimationFrame(tick)
      }
      raf.current = requestAnimationFrame(tick)
    }
  }, [hoop])

  const start = useCallback(async () => {
    if (!detectorRef.current || !ready) return
    const v = videoRef.current!
    try { if (v.paused) await v.play() } catch {}
    runningRef.current = true
    setRunning(true)
    setMsg('')
    ensureLoop()
  }, [ready, ensureLoop])

  const stop = useCallback(() => {
    runningRef.current = false
    setRunning(false)
  }, [])

  // hoop ROI draw / drag
  const dragging = useRef<{x:number,y:number}|null>(null)
  const onHudDown = (e: React.MouseEvent<HTMLCanvasElement>) => { const rect = (e.target as HTMLCanvasElement).getBoundingClientRect(); const x = e.clientX - rect.left; const y = e.clientY - rect.top; setHoop({ x, y, w: 120, h: 70 }); dragging.current = { x, y } }
  const onHudMove = (e: React.MouseEvent<HTMLCanvasElement>) => { if (!dragging.current) return; const rect = (e.target as HTMLCanvasElement).getBoundingClientRect(); const x = e.clientX - rect.left; const y = e.clientY - rect.top; setHoop(h => h ? ({ ...h, w: x - h.x, h: y - h.y }) : h) }
  const onHudUp = () => dragging.current = null

  const onPlay = () => { if (!runningRef.current) start() }
  const onPause = () => { stop() }

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center gap-3">
          <input type="file" accept="video/*" onChange={onFile} className="block w-full text-sm text-slate-300" />
          <button className="btn-outline" onClick={() => {
            const v = videoRef.current!; v.muted = true; navigator.mediaDevices.getUserMedia({ video: true }).then(stream => { v.srcObject = stream as any; v.onloadedmetadata = () => { v.play(); v.width = v.videoWidth; v.height = v.videoHeight; const cw = canvasRef.current!, hw = hudRef.current!; cw.width = v.videoWidth; cw.height = v.videoHeight; hw.width = v.videoWidth; hw.height = v.videoHeight; setReady(true) } })
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
          <button className="btn-outline mt-3" onClick={() => { const blob = new Blob([JSON.stringify(shots, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'shots.json'; a.click() }}>导出 JSON</button>
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
                <div className="text-slate-400 text-xs mt-1">释放肘角: {s.releaseElbowAngle?.toFixed(1) ?? '-'}°， 膝盖下蹲角: {s.kneeDipAngle?.toFixed(1) ?? '-'}°</div>
              </div>
            ))}
            {!shots.length && <p className="text-slate-400 text-sm">暂时没有数据</p>}
          </div>
        </div>
        <div className="card">
          <h3 className="text-lg font-medium mb-2">说明</h3>
          <p className="text-slate-400 text-sm">若点击“开始”无反应：1）确保视频已选择；2）在视频画面上先<strong>拖拽绘制篮筐 ROI</strong>；3）iOS 需手势触发播放，已在按钮中自动调用 play()；4）若仍异常，请刷新或更换视频再试。</p>
        </div>
      </aside>
    </div>
  )
}
