'use client'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as poseDetection from '@tensorflow-models/pose-detection'
import * as tf from '@tensorflow/tfjs-core'
import '@tensorflow/tfjs-converter'
import '@tensorflow/tfjs-backend-webgl'
import type { Hoop, Shot } from '@/lib/types'

type KP = { x: number, y: number, score?: number }

const LOCAL = {
  movenet: '/models/movenet_lightning/model.json',
  mpPoseDir: '/mediapipe/pose',
  wasmDir: '/wasm/'
}

const BUILD_TAG = 'fallback-v2'

async function headOk(url: string) {
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok } catch { return false }
}

async function createDetectorPreferLocal(setMsg: (s: string) => void) {
  try { await tf.setBackend('webgl'); await tf.ready(); setMsg(`WebGL 后端 ✔︎ · ${BUILD_TAG}`) }
  catch { const wasm = await import('@tensorflow/tfjs-backend-wasm'); (wasm as any).setWasmPaths?.(LOCAL.wasmDir); await tf.setBackend('wasm'); await tf.ready(); setMsg(`WASM 后端 ✔︎ · ${BUILD_TAG}`) }

  if (await headOk(`${LOCAL.mpPoseDir}/pose_solution_packed_assets.data`)) {
    try {
      const det = await poseDetection.createDetector(poseDetection.SupportedModels.BlazePose, { runtime: 'mediapipe', modelType: 'lite', solutionPath: LOCAL.mpPoseDir } as any)
      setMsg(`BlazePose（本地）✔︎ · ${BUILD_TAG}`); return det
    } catch (e) { console.warn('Local BlazePose failed', e) }
  }

  if (await headOk(LOCAL.movenet)) {
    try {
      const det = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, { modelType: 'lightning', modelUrl: LOCAL.movenet } as any)
      setMsg(`MoveNet（本地）✔︎ · ${BUILD_TAG}`); return det
    } catch (e) { console.warn('Local MoveNet failed', e) }
  }

  // —— 回退：远端资源 ——
  try {
    const det = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, { modelType: 'lightning' } as any)
    setMsg(`MoveNet（TFHub 回退）✔︎ · ${BUILD_TAG}`); return det
  } catch (e) { console.warn('Remote MoveNet failed → try remote BlazePose', e) }

  const det = await poseDetection.createDetector(poseDetection.SupportedModels.BlazePose, { runtime: 'mediapipe', modelType: 'lite', solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/pose' } as any)
  setMsg(`BlazePose（CDN 回退）✔︎ · ${BUILD_TAG}`)
  return det
}

export default function VideoAnalyzer() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hudRef = useRef<HTMLCanvasElement | null>(null)

  const [detector, setDetector] = useState<poseDetection.PoseDetector | null>(null)
  const [ready, setReady] = useState(false)
  const [msg, setMsg] = useState('正在加载模型…')

  const runningRef = useRef(false)
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null)
  const raf = useRef<number | null>(null)
  useEffect(() => { detectorRef.current = detector }, [detector])

  useEffect(() => { (async () => { try { const det = await createDetectorPreferLocal(setMsg); setDetector(det) } catch (e:any) { setMsg('模型加载失败：' + (e?.message || '未知错误')) } })() }, [])

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const url = URL.createObjectURL(file)
    const v = videoRef.current!; v.crossOrigin = 'anonymous'; v.src = url
    v.onloadedmetadata = () => {
      v.width = v.videoWidth; v.height = v.videoHeight
      const c = canvasRef.current!, h = hudRef.current!
      c.width = v.videoWidth; c.height = v.videoHeight
      h.width = v.videoWidth; h.height = v.videoHeight
      setReady(true); ensureLoop()
    }
  }, [])

  const ensureLoop = useCallback(() => {
    if (raf.current != null) return
    const tick = async () => {
      try {
        const v = videoRef.current, det = detectorRef.current, canvas = canvasRef.current, hud = hudRef.current
        if (!v || !canvas || !hud) { raf.current = requestAnimationFrame(tick); return }
        if (!runningRef.current || !det) { raf.current = requestAnimationFrame(tick); return }
        if (v.readyState < 2) { raf.current = requestAnimationFrame(tick); return }
        const ctx = canvas.getContext('2d')!, hctx = hud.getContext('2d')!
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
        const poses = await det.estimatePoses(v)
        const kps: KP[] = (poses?.[0]?.keypoints ?? []).map((k: any) => ({ x:k.x, y:k.y, score:k.score }))
        hctx.clearRect(0,0,hud.width,hud.height)
        if (kps.length){
          hctx.save(); hctx.lineWidth=3; hctx.strokeStyle='rgba(34,211,238,0.9)'; hctx.fillStyle='rgba(34,211,238,0.9)'
          const P: [number, number][] = [[5,6],[11,12],[5,7],[7,9],[6,8],[8,10],[11,13],[13,15],[12,14],[14,16],[5,11],[6,12]]
          for (const [a,b] of P){ const p1:any=kps[a], p2:any=kps[b]; if (p1?.score>0.3 && p2?.score>0.3){ hctx.beginPath(); hctx.moveTo(p1.x,p1.y); hctx.lineTo(p2.x,p2.y); hctx.stroke() } }
          kps.forEach((k:any)=>{ if(k?.score>0.3){ hctx.beginPath(); hctx.arc(k.x,k.y,4,0,Math.PI*2); hctx.fill() } })
          hctx.restore()
        }
      } catch {}
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }, [])

  const start = useCallback(async () => {
    if (!detectorRef.current || !ready) return
    const v = videoRef.current!
    try { if (v.paused) { v.muted = true; await v.play() } } catch {}
    runningRef.current = true; setMsg(`模型已加载 ✔︎ · ${BUILD_TAG}`); ensureLoop()
  }, [ready, ensureLoop])

  const stop = useCallback(() => { runningRef.current = false }, [])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input type="file" accept="video/*" onChange={onFile} className="block w-full text-sm text-slate-300" />
      </div>
      <div className="relative">
        <video ref={videoRef} className="w-full rounded border border-slate-700 bg-black" controls playsInline />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
        <canvas ref={hudRef} className="absolute inset-0 w-full h-full" />
      </div>
      <div className="flex gap-3">
        <button className="btn" onClick={start} disabled={!ready || !detector}>开始</button>
        <button className="btn-outline" onClick={stop}>停止</button>
        <span className="text-slate-400 text-sm">{msg}</span>
      </div>
    </div>
  )
}
