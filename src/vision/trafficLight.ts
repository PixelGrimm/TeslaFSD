export type SignalColor = 'red' | 'amber' | 'green' | 'off'

/**
 * Sample a traffic-light bbox in the video and decide which lamp is lit.
 */
export function sampleTrafficLightSignal(
  video: HTMLVideoElement,
  box: { x: number; y: number; width: number; height: number },
): SignalColor {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return 'off'

  const canvas = sampleTrafficLightSignal._c
  const ctx = sampleTrafficLightSignal._ctx
  const tw = 48
  const th = 72
  canvas.width = tw
  canvas.height = th

  const sx = box.x * vw
  const sy = box.y * vh
  const sw = Math.max(4, box.width * vw)
  const sh = Math.max(4, box.height * vh)
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, tw, th)
  const { data } = ctx.getImageData(0, 0, tw, th)

  // Split into top / mid / bottom thirds (EU vertical head)
  const scores = { red: 0, amber: 0, green: 0 }
  for (let y = 0; y < th; y++) {
    const band = y < th / 3 ? 'red' : y < (2 * th) / 3 ? 'amber' : 'green'
    for (let x = Math.floor(tw * 0.2); x < tw * 0.8; x++) {
      const i = (y * tw + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const bright = (r + g + b) / 3
      if (bright < 40) continue

      if (band === 'red' && r > 140 && r > g * 1.35 && r > b * 1.2) scores.red += bright
      if (band === 'amber' && r > 140 && g > 90 && b < r * 0.7 && r - b > 40) scores.amber += bright
      if (band === 'green' && g > 120 && g > r * 1.1 && g > b * 0.9) scores.green += bright

      // Also allow horizontal US heads: any strong hue anywhere
      if (r > 160 && r > g * 1.4 && r > b * 1.3) scores.red += bright * 0.35
      if (r > 150 && g > 110 && b < 90) scores.amber += bright * 0.35
      if (g > 150 && g > r * 1.15) scores.green += bright * 0.35
    }
  }

  const entries = Object.entries(scores) as [SignalColor, number][]
  entries.sort((a, b) => b[1] - a[1])
  if (entries[0][1] < 800) return 'off'
  return entries[0][0]
}

sampleTrafficLightSignal._c = document.createElement('canvas')
sampleTrafficLightSignal._ctx = sampleTrafficLightSignal._c.getContext('2d', {
  willReadFrequently: true,
})!
