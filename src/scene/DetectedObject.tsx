import type { WorldObject } from '../world/types'

/**
 * Tesla FSD–style traffic proxies: solid frosted bodies,
 * soft ground glow, same-dir cool blue / oncoming warm amber.
 */

const SAME = {
  body: '#c5d4e6',
  cabin: '#9eb4cc',
  glass: '#5a7a98',
  glow: '#5aa8ff',
  wheel: '#6a7688',
}

const ONCOMING = {
  body: '#e0d0c0',
  cabin: '#c0a890',
  glass: '#8a7060',
  glow: '#e88850',
  wheel: '#8a7a6a',
}

function VehicleProxy({ obj }: { obj: WorldObject }) {
  const kind =
    obj.className === 'truck' || obj.className === 'bus'
      ? 'truck'
      : obj.className === 'motorcycle'
        ? 'moto'
        : 'car'

  const c = obj.oncoming ? ONCOMING : SAME
  const op = obj.opacity
  const yaw = obj.oncoming ? 0 : Math.PI

  if (kind === 'moto') {
    return (
      <group position={[obj.displayX, 0, -obj.displayZ]} rotation={[0, yaw, 0]}>
        <mesh position={[0, 0.55, 0]} castShadow>
          <boxGeometry args={[0.45, 0.55, 1.7]} />
          <meshStandardMaterial color={c.body} transparent opacity={0.95 * op} roughness={0.4} metalness={0.15} />
        </mesh>
        <mesh position={[0, 0.95, -0.15]} castShadow>
          <boxGeometry args={[0.35, 0.45, 0.5]} />
          <meshStandardMaterial color={c.cabin} transparent opacity={0.95 * op} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.35, 0.55]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.28, 0.28, 0.12, 16]} />
          <meshStandardMaterial color={c.wheel} transparent opacity={0.95 * op} />
        </mesh>
        <mesh position={[0, 0.35, -0.55]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.28, 0.28, 0.12, 16]} />
          <meshStandardMaterial color={c.wheel} transparent opacity={0.95 * op} />
        </mesh>
        <GroundGlow color={c.glow} opacity={0.22 * op} radius={0.7} />
      </group>
    )
  }

  if (kind === 'truck') {
    const isBus = obj.className === 'bus'
    return (
      <group position={[obj.displayX, 0, -obj.displayZ]} rotation={[0, yaw, 0]}>
        <mesh position={[0, 1.05, isBus ? 0.2 : 1.55]} castShadow>
          <boxGeometry args={[2.35, 1.9, isBus ? 7.2 : 2.2]} />
          <meshStandardMaterial
            color={c.body}
            transparent
            opacity={0.94 * op}
            roughness={0.42}
            metalness={0.12}
          />
        </mesh>
        {!isBus && (
          <mesh position={[0, 1.35, -1.1]} castShadow>
            <boxGeometry args={[2.4, 2.5, 4.6]} />
            <meshStandardMaterial color={c.cabin} transparent opacity={0.94 * op} roughness={0.45} />
          </mesh>
        )}
        <mesh position={[0, 1.45, isBus ? 3.5 : 2.5]} rotation={[-0.25, 0, 0]}>
          <boxGeometry args={[2.1, 0.85, 0.08]} />
          <meshStandardMaterial
            color={c.glass}
            transparent
            opacity={0.75 * op}
            roughness={0.2}
            metalness={0.35}
          />
        </mesh>
        <Wheels
          color={c.wheel}
          opacity={op}
          width={2.35}
          zPositions={isBus ? [2.4, 0.4, -2.2] : [1.6, -2.4]}
          y={0.42}
          radius={0.42}
        />
        <GroundGlow color={c.glow} opacity={0.2 * op} radius={isBus ? 2.2 : 2.0} />
      </group>
    )
  }

  return (
    <group position={[obj.displayX, 0, -obj.displayZ]} rotation={[0, yaw, 0]}>
      <mesh position={[0, 0.42, 0]} castShadow>
        <boxGeometry args={[1.9, 0.55, 4.4]} />
        <meshStandardMaterial
          color={c.body}
          transparent
          opacity={0.95 * op}
          roughness={0.35}
          metalness={0.2}
        />
      </mesh>
      <mesh position={[0, 0.62, 1.35]} rotation={[0.12, 0, 0]} castShadow>
        <boxGeometry args={[1.75, 0.28, 1.1]} />
        <meshStandardMaterial color={c.body} transparent opacity={0.95 * op} roughness={0.35} metalness={0.2} />
      </mesh>
      <mesh position={[0, 1.05, -0.15]} castShadow>
        <boxGeometry args={[1.7, 0.85, 2.35]} />
        <meshStandardMaterial color={c.cabin} transparent opacity={0.94 * op} roughness={0.38} metalness={0.12} />
      </mesh>
      <mesh position={[0, 1.05, 1.05]} rotation={[-0.42, 0, 0]}>
        <boxGeometry args={[1.55, 0.7, 0.06]} />
        <meshStandardMaterial
          color={c.glass}
          transparent
          opacity={0.72 * op}
          roughness={0.15}
          metalness={0.4}
        />
      </mesh>
      <mesh position={[0, 1.05, -1.25]} rotation={[0.35, 0, 0]}>
        <boxGeometry args={[1.55, 0.65, 0.06]} />
        <meshStandardMaterial
          color={c.glass}
          transparent
          opacity={0.68 * op}
          roughness={0.15}
          metalness={0.35}
        />
      </mesh>
      <mesh position={[0, 1.48, -0.15]}>
        <boxGeometry args={[1.55, 0.06, 2.0]} />
        <meshStandardMaterial color="#e8eef6" transparent opacity={0.55 * op} roughness={0.25} />
      </mesh>
      <Wheels
        color={c.wheel}
        opacity={op}
        width={1.9}
        zPositions={[1.35, -1.35]}
        y={0.32}
        radius={0.32}
      />
      <GroundGlow color={c.glow} opacity={0.24 * op} radius={1.35} />
    </group>
  )
}

function Wheels({
  color,
  opacity,
  width,
  zPositions,
  y,
  radius,
}: {
  color: string
  opacity: number
  width: number
  zPositions: number[]
  y: number
  radius: number
}) {
  const x = width / 2 - 0.08
  return (
    <group>
      {zPositions.flatMap((z) =>
        [-x, x].map((wx) => (
          <mesh key={`${wx}-${z}`} position={[wx, y, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[radius, radius, 0.22, 14]} />
            <meshStandardMaterial color={color} transparent opacity={0.95 * opacity} roughness={0.7} />
          </mesh>
        )),
      )}
    </group>
  )
}

function GroundGlow({
  color,
  opacity,
  radius,
}: {
  color: string
  opacity: number
  radius: number
}) {
  return (
    <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[radius, 28]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  )
}

function PersonProxy({ obj }: { obj: WorldObject }) {
  const op = 0.95 * obj.opacity
  const body = '#b8c4d4'
  const accent = '#98a4b4'

  return (
    <group position={[obj.displayX, 0, -obj.displayZ]}>
      <mesh position={[-0.11, 0.42, 0]} castShadow>
        <capsuleGeometry args={[0.07, 0.5, 3, 6]} />
        <meshStandardMaterial color={accent} transparent opacity={op} roughness={0.65} />
      </mesh>
      <mesh position={[0.11, 0.42, 0]} castShadow>
        <capsuleGeometry args={[0.07, 0.5, 3, 6]} />
        <meshStandardMaterial color={accent} transparent opacity={op} roughness={0.65} />
      </mesh>
      <mesh position={[0, 1.05, 0]} castShadow>
        <capsuleGeometry args={[0.18, 0.55, 3, 8]} />
        <meshStandardMaterial color={body} transparent opacity={op} roughness={0.5} />
      </mesh>
      <mesh position={[-0.28, 1.05, 0]} rotation={[0.1, 0, 0.15]}>
        <capsuleGeometry args={[0.055, 0.4, 3, 6]} />
        <meshStandardMaterial color={body} transparent opacity={op} roughness={0.55} />
      </mesh>
      <mesh position={[0.28, 1.05, 0]} rotation={[0.1, 0, -0.15]}>
        <capsuleGeometry args={[0.055, 0.4, 3, 6]} />
        <meshStandardMaterial color={body} transparent opacity={op} roughness={0.55} />
      </mesh>
      <mesh position={[0, 1.68, 0]} castShadow>
        <sphereGeometry args={[0.15, 12, 12]} />
        <meshStandardMaterial color={body} transparent opacity={op} roughness={0.45} />
      </mesh>
      <GroundGlow color="#7a9cc8" opacity={0.22 * obj.opacity} radius={0.4} />
    </group>
  )
}

function TrafficLightProxy({ obj }: { obj: WorldObject }) {
  return (
    <group position={[obj.displayX, 0, -obj.displayZ]}>
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 3.2, 8]} />
        <meshStandardMaterial color="#5a6068" transparent opacity={0.95 * obj.opacity} />
      </mesh>
      <mesh position={[0, 3.35, 0]}>
        <boxGeometry args={[0.4, 1.05, 0.28]} />
        <meshStandardMaterial color="#2e3238" transparent opacity={0.95 * obj.opacity} />
      </mesh>
      {[0.32, 0, -0.32].map((y, i) => (
        <mesh key={i} position={[0, 3.35 + y, 0.12]}>
          <circleGeometry args={[0.1, 12]} />
          <meshBasicMaterial
            color={i === 0 ? '#ff5555' : i === 1 ? '#ffcc44' : '#44dd77'}
            transparent
            opacity={0.95 * obj.opacity}
          />
        </mesh>
      ))}
    </group>
  )
}

function StopSignProxy({ obj }: { obj: WorldObject }) {
  return (
    <group position={[obj.displayX, 0, -obj.displayZ]}>
      <mesh position={[0, 1.1, 0]}>
        <cylinderGeometry args={[0.045, 0.05, 2.2, 8]} />
        <meshStandardMaterial color="#6a6560" transparent opacity={obj.opacity} />
      </mesh>
      <mesh position={[0, 2.35, 0]} rotation={[0, 0, Math.PI / 8]}>
        <cylinderGeometry args={[0.42, 0.42, 0.06, 8]} />
        <meshStandardMaterial color="#d94040" transparent opacity={obj.opacity} />
      </mesh>
    </group>
  )
}

export function DetectedObject({ obj }: { obj: WorldObject }) {
  if (obj.className === 'person') return <PersonProxy obj={obj} />
  if (obj.className === 'traffic light') return <TrafficLightProxy obj={obj} />
  if (obj.className === 'stop sign') return <StopSignProxy obj={obj} />
  return <VehicleProxy obj={obj} />
}
