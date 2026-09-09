import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
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
        <meshStandardMaterial color="#9aa0a8" roughness={1} metalness={0} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[asphaltX, 0, midZ]} receiveShadow>
        <planeGeometry args={[asphaltW, spanZ]} />
        <meshStandardMaterial color="#5c6169" roughness={0.95} metalness={0} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, -28]}>
        <planeGeometry args={[half * 1.55, 56]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.5} depthWrite={false} />
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
        <meshBasicMaterial color="#e8eaee" transparent opacity={0.45} />
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
      <mesh castShadow>
        <boxGeometry args={[0.22, 0.16, len]} />
        <meshStandardMaterial color="#e8ebf0" roughness={0.88} />
      </mesh>
      <mesh position={[0, 0.1, 0]}>
        <boxGeometry args={[0.34, 0.05, len]} />
        <meshStandardMaterial color="#f2f4f7" roughness={0.8} />
      </mesh>
    </group>
  )
}
