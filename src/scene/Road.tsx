import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Group } from 'three'
import type { CurbState } from '../vision/curbTypes'
import type { EgoMotion, LaneMark, LaneState } from '../world/types'

interface RoadProps {
  lanes: LaneState
  motion: EgoMotion
  curbs: CurbState
}

/** Tesla-style road with ego / adjacent / oncoming lane markings + merges. */
export function Road({ lanes, motion, curbs }: RoadProps) {
  const dashGroup = useRef<Group>(null)
  const offset = useRef(0)
  const half = lanes.egoLaneHalfWidth

  const nearZ = 6
  const farZ = -130
  const midZ = (nearZ + farZ) / 2
  const spanZ = nearZ - farZ

  useFrame((_, dt) => {
    if (!dashGroup.current) return
    if (motion.speedMps < 0.4) return
    offset.current += motion.speedMps * dt
    dashGroup.current.position.z = ((offset.current % 8) + 8) % 8
  })

  const solids = lanes.marks.filter((m) => m.kind !== 'dashed_white')
  const dashes = lanes.marks.filter((m) => m.kind === 'dashed_white')

  const markXs = lanes.marks.map((m) => Math.min(m.x, m.xFar ?? m.x))
  const markXs2 = lanes.marks.map((m) => Math.max(m.x, m.xFar ?? m.x))
  const leftMark = markXs.length ? Math.min(...markXs) : -half
  const rightMark = markXs2.length ? Math.max(...markXs2) : half
  const leftBound = leftMark - 0.55
  const rightBound = rightMark + 0.55
  const roadW = Math.max(
    7,
    Math.min(24, rightBound - leftBound + 1.2, Math.max(curbs.roadHalfWidth * 2, 7)),
  )
  const asphaltW = Math.max(roadW, rightBound - leftBound + 1.4)
  const asphaltX = (leftBound + rightBound) / 2

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, midZ]} receiveShadow>
        <planeGeometry args={[120, spanZ + 40]} />
        <meshStandardMaterial 
          color="#a5abb5" 
          roughness={0.92} 
          metalness={0.02}
          envMapIntensity={0.3}
        />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[asphaltX, 0, midZ]} receiveShadow>
        <planeGeometry args={[asphaltW, spanZ]} />
        <meshStandardMaterial 
          color="#4a505a" 
          roughness={0.88} 
          metalness={0.05}
          envMapIntensity={0.4}
        />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, -28]}>
        <planeGeometry args={[half * 1.55, 56]} />
        <meshBasicMaterial 
          color="#4f9eff" 
          transparent 
          opacity={0.18} 
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {solids.map((m, i) => (
        <LaneMarkMesh key={`s-${m.kind}-${i}`} mark={m} nearZ={nearZ} farZ={farZ} />
      ))}

      <group ref={dashGroup}>
        {dashes.map((m, i) => (
          <LaneMarkMesh key={`d-${i}`} mark={m} nearZ={nearZ} farZ={farZ} />
        ))}
      </group>

      <CurbRail x={leftBound} nearZ={nearZ} farZ={farZ} />
      <CurbRail x={rightBound} nearZ={nearZ} farZ={farZ} />

      <mesh position={[0, 10, -140]}>
        <planeGeometry args={[160, 50]} />
        <meshBasicMaterial color="#dce2ea" transparent opacity={0.55} />
      </mesh>
    </group>
  )
}

function LaneMarkMesh({
  mark,
  nearZ,
  farZ,
}: {
  mark: LaneMark
  nearZ: number
  farZ: number
}) {
  const xNear = mark.x
  const xFar = mark.xFar ?? mark.x
  const opacity = mark.opacity ?? 1
  const color =
    mark.kind === 'double_yellow' || mark.kind === 'solid_yellow' ? '#f0c93a' : '#ffffff'
  const poly = mark.poly && mark.poly.length >= 2 ? mark.poly : null

  if (poly) {
    if (mark.kind === 'dashed_white') {
      return <PolyDashes poly={poly} color={color} opacity={opacity} />
    }
    if (mark.kind === 'double_yellow') {
      return (
        <group>
          {[-0.11, 0.11].map((dx) => (
            <PolyStrip key={dx} poly={offsetPoly(poly, dx)} width={0.11} color={color} opacity={opacity} />
          ))}
        </group>
      )
    }
    return <PolyStrip poly={poly} width={0.14} color={color} opacity={opacity} />
  }

  if (mark.kind === 'dashed_white') {
    const segs: { z: number; x: number }[] = []
    for (let z = farZ - 10; z < nearZ + 10; z += 8) {
      const t = (z - nearZ) / (farZ - nearZ)
      const x = xNear + (xFar - xNear) * t
      segs.push({ z, x })
    }
    return (
      <group>
        {segs.map((s) => (
          <mesh key={s.z} position={[s.x, 0.05, s.z]}>
            <boxGeometry args={[0.13, 0.025, 2.8]} />
            <meshBasicMaterial color={color} transparent opacity={opacity} />
          </mesh>
        ))}
      </group>
    )
  }

  if (mark.kind === 'double_yellow') {
    return (
      <group>
        {[-0.11, 0.11].map((dx) => (
          <ConvergingStrip
            key={dx}
            xNear={xNear + dx}
            xFar={xFar + dx}
            nearZ={nearZ}
            farZ={farZ}
            width={0.11}
            color={color}
            opacity={opacity}
          />
        ))}
      </group>
    )
  }

  return (
    <ConvergingStrip
      xNear={xNear}
      xFar={xFar}
      nearZ={nearZ}
      farZ={farZ}
      width={0.14}
      color={color}
      opacity={opacity}
    />
  )
}

function offsetPoly(poly: { z: number; x: number }[], dx: number) {
  return poly.map((p) => ({ z: p.z, x: p.x + dx }))
}

/** Continuous strip segments along ego-frame poly (z forward → Three −z). */
function PolyStrip({
  poly,
  width,
  color,
  opacity,
}: {
  poly: { z: number; x: number }[]
  width: number
  color: string
  opacity: number
}) {
  const segs: { midX: number; midZ: number; len: number; yaw: number }[] = []
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i]
    const b = poly[i + 1]
    const zA = -a.z
    const zB = -b.z
    const dx = b.x - a.x
    const dz = zB - zA
    const len = Math.hypot(dx, dz)
    if (len < 0.05) continue
    // Reject nearly sideways segments (broken vision polys)
    const yaw = Math.atan2(dx, dz)
    if (Math.abs(yaw) > 0.55) continue
    segs.push({
      midX: (a.x + b.x) / 2,
      midZ: (zA + zB) / 2,
      len,
      yaw,
    })
  }
  return (
    <group>
      {segs.map((s, i) => (
        <mesh key={i} position={[s.midX, 0.045, s.midZ]} rotation={[0, -s.yaw, 0]}>
          <boxGeometry args={[width, 0.025, s.len]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} />
        </mesh>
      ))}
    </group>
  )
}

/** Dashes placed along polyline arc length. */
function PolyDashes({
  poly,
  color,
  opacity,
}: {
  poly: { z: number; x: number }[]
  color: string
  opacity: number
}) {
  const dashLen = 2.8
  const gap = 5.2
  const period = dashLen + gap
  const pts = poly.map((p) => ({ x: p.x, z: -p.z }))

  // Arc-length table
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)
    cum.push(cum[i - 1] + d)
  }
  const total = cum[cum.length - 1]
  if (total < 0.5) return null

  const segs: { x: number; z: number; yaw: number }[] = []
  for (let s = 0; s < total; s += period) {
    const mid = s + dashLen * 0.5
    if (mid > total) break
    const p = pointAtArc(pts, cum, mid)
    const p2 = pointAtArc(pts, cum, Math.min(total, mid + 0.35))
    const yaw = Math.atan2(p2.x - p.x, p2.z - p.z)
    segs.push({ x: p.x, z: p.z, yaw })
  }

  return (
    <group>
      {segs.map((s, i) => (
        <mesh key={i} position={[s.x, 0.05, s.z]} rotation={[0, -s.yaw, 0]}>
          <boxGeometry args={[0.13, 0.025, dashLen]} />
          <meshBasicMaterial color={color} transparent opacity={opacity} />
        </mesh>
      ))}
    </group>
  )
}

function pointAtArc(
  pts: { x: number; z: number }[],
  cum: number[],
  s: number,
): { x: number; z: number } {
  if (s <= 0) return pts[0]
  if (s >= cum[cum.length - 1]) return pts[pts.length - 1]
  for (let i = 0; i < cum.length - 1; i++) {
    if (s >= cum[i] && s <= cum[i + 1]) {
      const span = Math.max(1e-6, cum[i + 1] - cum[i])
      const t = (s - cum[i]) / span
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        z: pts[i].z + (pts[i + 1].z - pts[i].z) * t,
      }
    }
  }
  return pts[pts.length - 1]
}

/** Solid strip that can taper in X from near → far (lane merge). */
function ConvergingStrip({
  xNear,
  xFar,
  nearZ,
  farZ,
  width,
  color,
  opacity,
}: {
  xNear: number
  xFar: number
  nearZ: number
  farZ: number
  width: number
  color: string
  opacity: number
}) {
  const midX = (xNear + xFar) / 2
  const midZ = (nearZ + farZ) / 2
  const dz = farZ - nearZ
  const dx = xFar - xNear
  const len = Math.hypot(dx, dz)
  const yaw = Math.atan2(dx, dz)

  return (
    <mesh position={[midX, 0.045, midZ]} rotation={[0, -yaw, 0]}>
      <boxGeometry args={[width, 0.025, len]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} />
    </mesh>
  )
}

function CurbRail({
  x,
  nearZ,
  farZ,
}: {
  x: number
  nearZ: number
  farZ: number
}) {
  const midZ = (nearZ + farZ) / 2
  const len = nearZ - farZ

  return (
    <group position={[x, 0.08, midZ]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.22, 0.16, len]} />
        <meshStandardMaterial 
          color="#e5e9ef" 
          roughness={0.75} 
          metalness={0.08}
          envMapIntensity={0.5}
        />
      </mesh>
      <mesh position={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.34, 0.05, len]} />
        <meshStandardMaterial 
          color="#f5f7fa" 
          roughness={0.65} 
          metalness={0.12}
          envMapIntensity={0.6}
        />
      </mesh>
    </group>
  )
}
