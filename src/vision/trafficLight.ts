export type SignalColor = 'red' | 'amber' | 'green' | 'off'

/**
 * ITS-style traffic-light color: sample the detection ROI in HSV
 * (as in intelligent-transportation-system), with vertical-band bias
 * for EU heads and light temporal hysteresis.
 */
export function sampleTrafficLightSignal(
  video: HTMLVideoElement,
  box: { x: number; y: number; width: number; height: number },
  previous: SignalColor = 'off',
): SignalColor {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return previous

  const canvas = sampleTrafficLightSignal._c
  const ctx = sampleTrafficLightSignal._ctx
  const tw = 40
  const th = 64
  canvas.width = tw
  canvas.height = th

  // Slight inset to avoid housing / sky bleed
  const padX = box.width * 0.12
  const padY = box.height * 0.08
  const sx = (box.x + padX) * vw
  const sy = (box.y + padY) * vh
  const sw = Math.max(4, (box.width - padX * 2) * vw)
  const sh = Math.max(4, (box.height - padY * 2) * vh)
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, tw, th)
  const { data } = ctx.getImageData(0, 0, tw, th)

  const scores = { red: 0, amber: 0, green: 0 }
  let litPixels = 0

  for (let y = 0; y < th; y++) {
    const band: SignalColor =
      y < th * 0.34 ? 'red' : y < th * 0.66 ? 'amber' : 'green'
    for (let x = Math.floor(tw * 0.18); x < tw * 0.82; x++) {
      const i = (y * tw + x) * 4
      const { h, s, v } = rgbToHsv(data[i], data[i + 1], data[i + 2])
      // Unlit lamps / housing
      if (v < 0.28 || s < 0.22) continue
      litPixels++

      const hue = classifyHue(h, s, v)
      if (!hue) continue

      // Weight: matching vertical band (EU) + any strong lit lamp (US / side)
      const bandBoost = hue === band ? 1.6 : 0.55
      const brightBoost = 0.6 + v
      scores[hue] += bandBoost * brightBoost
    }
  }

  const entries = (Object.entries(scores) as [Exclude<SignalColor, 'off'>, number][]).sort(
    (a, b) => b[1] - a[1],
  )
  const [top, topScore] = entries[0]
  const second = entries[1][1]

  // Need a clear lit signal
  if (litPixels < 8 || topScore < 12 || topScore < second * 1.15) {
    // Hold previous briefly when ROI is noisy
    return previous !== 'off' ? previous : 'off'
  }

  // Hysteresis: don't flip on tiny margins
  if (previous !== 'off' && previous !== top && topScore < second * 1.45 + 4) {
    return previous
  }
  return top
}

function classifyHue(h: number, s: number, v: number): Exclude<SignalColor, 'off'> | null {
  // Red wraps around 0°
  if ((h <= 18 || h >= 345) && s > 0.35 && v > 0.32) return 'red'
  // Amber / yellow / orange
  if (h > 18 && h < 58 && s > 0.35 && v > 0.38) return 'amber'
  // Green / cyan-green (LED heads often lean cyan)
  if (h >= 70 && h <= 175 && s > 0.22 && v > 0.3) return 'green'
  return null
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d > 1e-6) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max <= 1e-6 ? 0 : d / max
  return { h, s, v: max }
}

sampleTrafficLightSignal._c = document.createElement('canvas')
sampleTrafficLightSignal._ctx = sampleTrafficLightSignal._c.getContext('2d', {
  willReadFrequently: true,
})!
