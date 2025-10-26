import { promises as fs } from 'fs'
import path from 'path'
import https from 'https'

const root = process.cwd()
const publicDir = path.join(root, 'public')

async function ensureDir(p) { await fs.mkdir(p, { recursive: true }) }

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(downloadToFile(res.headers.location, dest))
      }
      if (res.statusCode !== 200) return reject(new Error(`GET ${url} -> ${res.statusCode}`))
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', async () => {
        try {
          await ensureDir(path.dirname(dest))
          await fs.writeFile(dest, Buffer.concat(chunks))
          resolve()
        } catch (e) { reject(e) }
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function copyDir(src, dst) {
  await ensureDir(dst)
  await fs.cp(src, dst, { recursive: true })
}

async function prepareMediapipe() {
  const src = path.join(root, 'node_modules', '@mediapipe', 'pose')
  const dst = path.join(publicDir, 'mediapipe', 'pose')
  try {
    await copyDir(src, dst)
    console.log('Copied mediapipe pose ->', dst)
  } catch (e) {
    console.warn('Skip mediapipe copy:', e?.message)
  }
}

async function prepareWasm() {
  const src = path.join(root, 'node_modules', '@tensorflow', 'tfjs-backend-wasm', 'dist')
  const dst = path.join(publicDir, 'wasm')
  try {
    await copyDir(src, dst)
    console.log('Copied tfjs wasm ->', dst)
  } catch (e) {
    console.warn('Skip wasm copy:', e?.message)
  }
}

async function prepareMoveNet() {
  const base = 'https://storage.googleapis.com/tfhub-tfjs-modules/google/tfjs-model/movenet/singlepose/lightning/4'
  const dst = path.join(publicDir, 'models', 'movenet_lightning')
  await ensureDir(dst)
  const modelJsonPath = path.join(dst, 'model.json')
  try {
    await fs.stat(modelJsonPath)
    console.log('MoveNet model exists, skip download')
    return
  } catch { /* not exists */ }
  const modelUrl = `${base}/model.json`
  console.log('Downloading', modelUrl)
  await downloadToFile(modelUrl, modelJsonPath)
  const model = JSON.parse(await fs.readFile(modelJsonPath, 'utf-8'))
  const manifests = model.weightsManifest || []
  for (const m of manifests) {
    for (const p of (m.paths || [])) {
      const url = `${base}/${p}`
      const target = path.join(dst, p)
      console.log('Downloading', url)
      await downloadToFile(url, target)
    }
  }
}

async function main() {
  await ensureDir(publicDir)
  await Promise.all([prepareMediapipe(), prepareWasm(), prepareMoveNet()])
}

main().catch(err => {
  console.error('prepare-assets failed:', err)
  // 不阻断构建：运行时仍有远端回退
  process.exit(0)
})
