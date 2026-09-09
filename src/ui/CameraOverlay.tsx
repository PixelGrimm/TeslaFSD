import { useEffect, useRef, type RefObject } from 'react'
import type { EgoMotion, PerceptionOverlay } from '../world/types'

interface CameraOverlayProps {
  videoRef: RefObject<HTMLVideoElement | null>
  overlay: PerceptionOverlay
  motion: EgoMotion
  visible: boolean
}

const CLASS_COLOR: Record<string, string> = {
  car: '#5b9cff',
  truck: '#7eb6ff',
  bus: '#9bc4ff',
  motorcycle: '#a8d4ff',
  person: '#3ddc84',
  'traffic light': '#f0c93a',
  'stop sign': '#ff6b6b',
}

/** Draws detection boxes + classified lane lines on the live camera PiP. */
export function CameraOverlay({ videoRef, overlay, motion, visible }: CameraOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef(overlay)
  const motionRef = useRef(motion)
  const dashPhase = useRef(0)
  const lastTs = useRef(0)
  overlayRef.current = overlay
  motionRef.current = motion

  useEffect(() => {
    if (!visible) return
    let raf = 0

    const draw = (ts: number) => {
      raf = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      const video = videoRef.current
      const data = overlayRef.current
      const mot = motionRef.current
      if (!canvas || !video) return

      const dt = lastTs.current ? Math.min(0.05, (ts - lastTs.current) / 1000) : 0.016
      lastTs.current = ts
      if (mot.speedMps > 0.4) {
        dashPhase.current = (dashPhase.current + mot.speedMps * dt * 18) % 40
      }

      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (w < 2 || h < 2) return
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, w, h)

      const y0 = data.bandTop * h
      const y1 = data.bandBottom * h
      const vanishY = y0 - h * 0.1
      const vanishX = (data.vpX ?? 0.5) * w

      ctx.fillStyle = 'rgba(59, 130, 246, 0.06)'
      ctx.fillRect(0, y0, w, y1 - y0)

      const lines = data.lines.length
        ? data.lines
        : [
            ...data.yellowPeaks.map((x) => ({
              x,
              color: 'yellow' as const,
              style: 'solid' as const,
            })),
            ...data.whitePeaks.map((x, i, arr) => ({
              x,
              color: 'white' as const,
              style: (i === 0 || i === arr.length - 1 ? 'solid' : 'dashed') as
                | 'solid'
                | 'dashed',
            })),
          ]

      for (const line of lines) {
        const xBot = line.x * w
        const xTop = vanishX + (xBot - vanishX) * 0.12
        const isYellow = line.color === 'yellow'
        const color = isYellow ? '#f0c93a' : '#ffffff'

        ctx.strokeStyle = color
        ctx.lineWidth = isYellow ? 3 : 2.25
        if (line.style === 'dashed') {
          ctx.setLineDash([7, 6])
          ctx.lineDashOffset = -dashPhase.current
        } else {
          ctx.setLineDash([])
          ctx.lineDashOffset = 0
        }

        // Quadratic bend toward vanishing point (road curve / perspective)
        const midY = y1 * 0.55 + vanishY * 0.45
        const linearMid = xBot + (xTop - xBot) * 0.45
        const ctrlX = linearMid + (vanishX - linearMid) * 0.22

        ctx.beginPath()
        ctx.moveTo(xBot, y1)
        ctx.quadraticCurveTo(ctrlX, midY, xTop, vanishY)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.lineDashOffset = 0

        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(xBot, y1 - 2, isYellow ? 3.5 : 2.8, 0, Math.PI * 2)
        ctx.fill()
      }

      for (const det of data.detections) {
        const color = det.oncoming
          ? '#ff8a3d'
          : (CLASS_COLOR[det.className] ?? '#ffffff')
        const bx = det.box.x * w
        const by = det.box.y * h
        const bw = det.box.width * w
        const bh = det.box.height * h

        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.strokeRect(bx, by, bw, bh)

        const label = `${det.className} ${Math.round(det.score * 100)}%`
        ctx.font = '600 10px "DM Sans", system-ui, sans-serif'
        const tw = ctx.measureText(label).width + 8
        const th = 14
        const ly = Math.max(0, by - th)
        ctx.fillStyle = 'rgba(10,12,16,0.75)'
        ctx.fillRect(bx, ly, tw, th)
        ctx.fillStyle = color
        ctx.fillText(label, bx + 4, ly + 10)
      }

      // Locked / candidate speed-limit sign
      if (data.speedLimit) {
        const sl = data.speedLimit
        const bx = sl.box.x * w
        const by = sl.box.y * h
        const bw = Math.max(14, sl.box.width * w)
        const bh = Math.max(14, sl.box.height * h)
        const cx = bx + bw / 2
        const cy = by + bh / 2
        const r = Math.max(bw, bh) * 0.55
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.strokeStyle =
          sl.value === 'national'
            ? sl.locked
              ? '#888'
              : 'rgba(120,120,120,0.55)'
            : sl.locked
              ? '#e30613'
              : 'rgba(227,6,19,0.55)'
        ctx.lineWidth = sl.locked ? 3 : 2
        ctx.stroke()
        if (sl.locked) {
          ctx.beginPath()
          ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(255,255,255,0.88)'
          ctx.fill()
          if (sl.value === 'national') {
            ctx.save()
            ctx.translate(cx, cy)
            ctx.rotate(-Math.PI / 4)
            ctx.fillStyle = '#111'
            ctx.fillRect(-r * 0.5, -r * 0.1, r, r * 0.2)
            ctx.restore()
          } else {
            ctx.fillStyle = '#111'
            ctx.font = `700 ${Math.max(10, r * 0.7)}px "DM Sans", system-ui, sans-serif`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(String(sl.value), cx, cy + 1)
            ctx.textAlign = 'start'
            ctx.textBaseline = 'alphabetic'
          }
        }
      }

      const hud = [
        `lanes ${data.sameLanes}`,
        data.hasYellow
          ? data.oncomingLanes > 0
            ? `yellow+oncoming ${data.oncomingLanes}`
            : 'yellow edge'
          : data.oncomingLanes > 0
            ? `oncoming ${data.oncomingLanes}`
            : null,
        data.speedLimit?.locked
          ? data.speedLimit.value === 'national'
            ? 'limit NSL'
            : `limit ${data.speedLimit.value}`
          : null,
        mot.moving ? `${mot.speedMph} mph` : 'stopped',
        `objs ${data.detections.length}`,
      ]
        .filter(Boolean)
        .join(' · ')
      ctx.font = '600 9px "DM Sans", system-ui, sans-serif'
      const hw = ctx.measureText(hud).width + 10
      ctx.fillStyle = 'rgba(10,12,16,0.7)'
      ctx.fillRect(4, 4, hw, 16)
      ctx.fillStyle = '#e8ecf2'
      ctx.fillText(hud, 9, 15)
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [visible, videoRef])

  return (
    <canvas
      ref={canvasRef}
      className={`camera-overlay ${visible ? 'visible' : ''}`}
      aria-hidden
    />
  )
}
