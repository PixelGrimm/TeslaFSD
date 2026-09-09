import type { SceneExtras } from '../world/types'

/**
 * Infer soft urban massing (building blocks) from vertical structure
 * on the image sides — Tesla-like facades, not photoreal buildings.
 */
export function detectUrbanSurroundings(video: HTMLVideoElement): SceneExtras['buildings'] {
  if (video.readyState < 2 || video.videoWidth === 0) return []

  const w = 160
  const h = 90
  const c = detectUrbanSurroundings._c
  const ctx = detectUrbanSurroundings._ctx
  c.width = w
  c.height = h
  ctx.drawImage(video, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)

  const sides: Array<{ side: -1 | 1; x0: number; x1: number }> = [
    { side: -1, x0: 0, x1: Math.floor(w * 0.28) },
    { side: 1, x0: Math.floor(w * 0.72), x1: w },
  ]

  const buildings: SceneExtras['buildings'] = []

  for (const s of sides) {
    let edge = 0
    let n = 0
    for (let y = Math.floor(h * 0.05); y < h * 0.55; y += 2) {
      for (let x = s.x0 + 1; x < s.x1 - 1; x += 2) {
        const i = (y * w + x) * 4
        const i2 = (y * w + (x + 1)) * 4
        const b1 = (data[i] + data[i + 1] + data[i + 2]) / 3
        const b2 = (data[i2] + data[i2 + 1] + data[i2 + 2]) / 3
        if (Math.abs(b1 - b2) > 28) edge++
        n++
      }
    }
    const density = n ? edge / n : 0
    if (density < 0.08) continue

    const count = density > 0.18 ? 4 : density > 0.12 ? 3 : 2
    for (let i = 0; i < count; i++) {
      const z = 12 + i * 18 + (s.side > 0 ? 4 : 0)
      const height = 8 + (density * 40) + (i % 2) * 3
      const depth = 10 + (i % 3) * 4
      const width = 6 + (i % 2) * 2
      buildings.push({
        side: s.side,
        x: s.side * (9 + width * 0.35),
        z,
        width,
        height,
        depth,
      })
    }
  }

  return buildings
}

detectUrbanSurroundings._c = document.createElement('canvas')
detectUrbanSurroundings._ctx = detectUrbanSurroundings._c.getContext('2d', {
  willReadFrequently: true,
})!
