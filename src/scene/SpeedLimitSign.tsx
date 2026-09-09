import { useEffect, useMemo } from 'react'
import { CanvasTexture, SRGBColorSpace } from 'three'
import type { SpeedLimitSignState } from '../world/types'

function makeEuSignTexture(value: number | 'national'): CanvasTexture {
  const size = 256
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!

  ctx.clearRect(0, 0, size, size)
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 6

  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  if (value === 'national') {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = '#c4c4c4'
    ctx.lineWidth = 4
    ctx.stroke()

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(-Math.PI / 4)
    ctx.fillStyle = '#111111'
    ctx.fillRect(-r * 0.72, -size * 0.055, r * 1.44, size * 0.11)
    ctx.restore()
  } else {
    ctx.beginPath()
    ctx.arc(cx, cy, r - 2, 0, Math.PI * 2)
    ctx.strokeStyle = '#e30613'
    ctx.lineWidth = size * 0.13
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = '#c4c4c4'
    ctx.lineWidth = 3
    ctx.stroke()

    const text = String(value)
    ctx.fillStyle = '#111111'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const fontSize = text.length >= 3 ? size * 0.36 : size * 0.46
    ctx.font = `700 ${fontSize}px "DM Sans", Arial, Helvetica, sans-serif`
    ctx.fillText(text, cx, cy + size * 0.02)
  }

  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

/** EU circular speed-limit / UK national limit sign on a roadside pole. */
export function SpeedLimitSign({ sign }: { sign: SpeedLimitSignState }) {
  const texture = useMemo(() => makeEuSignTexture(sign.value), [sign.value])

  useEffect(() => {
    return () => {
      texture.dispose()
    }
  }, [texture])

  const diameter = 0.95
  const radius = diameter / 2
  const faceY = 2.05
  const poleTop = faceY - radius + 0.02
  const poleH = Math.max(0.4, poleTop)

  return (
    <group
      position={[sign.displayX, 0, -sign.displayZ]}
      rotation={[0, sign.displayX < 0 ? Math.PI * 0.12 : -Math.PI * 0.12, 0]}
    >
      <mesh position={[0, poleH / 2, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.042, poleH, 10]} />
        <meshStandardMaterial color="#6a6560" roughness={0.85} metalness={0.2} />
      </mesh>

      <mesh position={[0, poleTop - 0.02, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.06, 10]} />
        <meshStandardMaterial color="#55524e" roughness={0.7} metalness={0.35} />
      </mesh>

      <mesh position={[0, faceY, 0.025]} castShadow>
        <circleGeometry args={[radius, 48]} />
        <meshBasicMaterial map={texture} transparent opacity={sign.opacity} toneMapped={false} />
      </mesh>
      <mesh position={[0, faceY, -0.012]}>
        <circleGeometry args={[radius, 32]} />
        <meshStandardMaterial
          color="#d8d8d8"
          roughness={0.7}
          transparent
          opacity={sign.opacity}
        />
      </mesh>
    </group>
  )
}
