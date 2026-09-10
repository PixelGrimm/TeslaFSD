import type { WorldObject } from '../world/types'

/**
 * Tesla FSD–style traffic: frosted sedan/SUV/truck silhouettes with
 * greenhouse, bumper, wheels, and soft ground glow.
 */

const SAME = {
  body: '#b8c8dc',
  cabin: '#8098b8',
  glass: '#3a5a78',
  trim: '#d0dff0',
  glow: '#4a9cff',
  wheel: '#3a4554',
  tire: '#1a2028',
}

const ONCOMING = {
  body: '#dcc8b4',
  cabin: '#b89878',
  glass: '#7a6048',
  trim: '#ead8c8',
  glow: '#e88850',
  wheel: '#6a5a4a',
  tire: '#3a3228',
}

function VehicleProxy({ obj }: { obj: WorldObject }) {
  const kind =
    obj.className === 'truck' || obj.className === 'bus'
      ? 'truck'
      : obj.className === 'motorcycle'
        ? 'moto'
        : 'car'

  const c = obj.oncoming ? ONCOMING : SAME
  const op = Math.min(1, obj.opacity)
  const yaw = obj.oncoming ? 0 : Math.PI

  if (kind === 'moto') return <MotoMesh c={c} op={op} obj={obj} yaw={yaw} />
  if (kind === 'truck') return <TruckMesh c={c} op={op} obj={obj} yaw={yaw} />
  return <SedanMesh c={c} op={op} obj={obj} yaw={yaw} />
}

type Palette = typeof SAME

function SedanMesh({
  c,
  op,
  obj,
  yaw,
}: {
  c: Palette
  op: number
  obj: WorldObject
  yaw: number
}) {
  return (
    <group position={[obj.displayX, 0, -obj.displayZ]} rotation={[0, yaw, 0]}>
      {/* Shadow / glow */}
      <GroundGlow color={c.glow} opacity={0.35 * op} radius={1.5} />

      {/* Lower body tub */}
      <mesh position={[0, 0.38, 0.05]} castShadow>
        <boxGeometry args={[1.92, 0.48, 4.5]} />
        <meshStandardMaterial 
          color={c.body} 
          transparent 
          opacity={0.96 * op} 
          roughness={0.32} 
          metalness={0.38}
          envMapIntensity={0.6}
        />
      </mesh>
      {/* Side skirts flare */}
      <mesh position={[0, 0.22, 0]} castShadow>
        <boxGeometry args={[2.02, 0.18, 4.2]} />
        <meshStandardMaterial color={c.body} transparent opacity={0.95 * op} roughness={0.42} metalness={0.2} />
      </mesh>
      {/* Hood */}
      <mesh position={[0, 0.62, 1.25]} rotation={[0.08, 0, 0]} castShadow>
        <boxGeometry args={[1.78, 0.22, 1.35]} />
        <meshStandardMaterial color={c.trim} transparent opacity={0.95 * op} roughness={0.32} metalness={0.3} />
      </mesh>
      {/* Cabin */}
      <mesh position={[0, 1.02, -0.2]} castShadow>
        <boxGeometry args={[1.68, 0.78, 2.2]} />
        <meshStandardMaterial 
          color={c.cabin} 
          transparent 
          opacity={0.95 * op} 
          roughness={0.35} 
          metalness={0.22}
          envMapIntensity={0.5}
        />
      </mesh>
      {/* Roof */}
      <mesh position={[0, 1.42, -0.25]}>
        <boxGeometry args={[1.5, 0.08, 1.85]} />
        <meshStandardMaterial 
          color={c.trim} 
          transparent 
          opacity={0.75 * op} 
          roughness={0.18} 
          metalness={0.45}
          envMapIntensity={0.7}
        />
      </mesh>
      {/* Windshield */}
      <mesh position={[0, 1.05, 0.95]} rotation={[-0.48, 0, 0]}>
        <boxGeometry args={[1.52, 0.72, 0.05]} />
        <meshStandardMaterial 
          color={c.glass} 
          transparent 
          opacity={0.68 * op} 
          roughness={0.08} 
          metalness={0.6}
          envMapIntensity={0.9}
        />
      </mesh>
      {/* Rear glass */}
      <mesh position={[0, 1.08, -1.28]} rotation={[0.4, 0, 0]}>
        <boxGeometry args={[1.52, 0.62, 0.05]} />
        <meshStandardMaterial 
          color={c.glass} 
          transparent 
          opacity={0.62 * op} 
          roughness={0.08} 
          metalness={0.55}
          envMapIntensity={0.85}
        />
      </mesh>
      {/* Side glass L/R */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.84, 1.05, -0.15]} rotation={[0, 0, s * 0.08]}>
          <boxGeometry args={[0.04, 0.55, 1.7]} />
          <meshStandardMaterial color={c.glass} transparent opacity={0.55 * op} roughness={0.15} metalness={0.4} />
        </mesh>
      ))}
      {/* Front bumper */}
      <mesh position={[0, 0.28, 2.22]}>
        <boxGeometry args={[1.85, 0.28, 0.22]} />
        <meshStandardMaterial color={c.body} transparent opacity={0.96 * op} roughness={0.45} />
      </mesh>
      {/* Rear bumper */}
      <mesh position={[0, 0.28, -2.2]}>
        <boxGeometry args={[1.85, 0.28, 0.22]} />
        <meshStandardMaterial color={c.body} transparent opacity={0.96 * op} roughness={0.45} />
      </mesh>
      {/* Headlights */}
      {[-0.62, 0.62].map((x) => (
        <mesh key={x} position={[x, 0.48, 2.28]}>
          <boxGeometry args={[0.35, 0.14, 0.06]} />
          <meshBasicMaterial
            color={obj.oncoming ? '#ffaa55' : '#ffffff'}
            transparent
            opacity={0.95 * op}
            toneMapped={false}
          />
        </mesh>
      ))}
      {/* Headlight glow */}
      {obj.oncoming && [-0.62, 0.62].map((x) => (
        <pointLight 
          key={`hl${x}`}
          position={[x, 0.48, 2.35]} 
          color="#ffaa44" 
          intensity={1.5 * op} 
          distance={8}
          decay={2}
        />
      ))}
      {/* Taillights */}
      {[-0.62, 0.62].map((x) => (
        <mesh key={`t${x}`} position={[x, 0.52, -2.28]}>
          <boxGeometry args={[0.32, 0.12, 0.05]} />
          <meshBasicMaterial 
            color="#ff4455" 
            transparent 
            opacity={0.9 * op}
            toneMapped={false}
          />
        </mesh>
      ))}
      <WheelSet c={c} op={op} width={1.95} zs={[1.4, -1.35]} y={0.3} r={0.3} />
    </group>
  )
}

function TruckMesh({
  c,
  op,
  obj,
  yaw,
}: {
  c: Palette
  op: number
  obj: WorldObject
  yaw: number
}) {
  const isBus = obj.className === 'bus'
  return (
    <group position={[obj.displayX, 0, -obj.displayZ]} rotation={[0, yaw, 0]}>
      <GroundGlow color={c.glow} opacity={0.22 * op} radius={isBus ? 2.4 : 2.1} />
      <mesh position={[0, 1.15, isBus ? 0.1 : 1.65]} castShadow>
        <boxGeometry args={[2.4, 2.1, isBus ? 7.4 : 2.4]} />
        <meshStandardMaterial color={c.body} transparent opacity={0.95 * op} roughness={0.42} metalness={0.15} />
      </mesh>
      {!isBus && (
        <mesh position={[0, 1.55, -1.15]} castShadow>
          <boxGeometry args={[2.45, 2.7, 4.8]} />
          <meshStandardMaterial color={c.cabin} transparent opacity={0.94 * op} roughness={0.48} />
        </mesh>
      )}
      <mesh position={[0, 1.55, isBus ? 3.55 : 2.65]} rotation={[-0.2, 0, 0]}>
        <boxGeometry args={[2.15, 0.95, 0.08]} />
        <meshStandardMaterial color={c.glass} transparent opacity={0.75 * op} roughness={0.15} metalness={0.4} />
      </mesh>
      {[-0.7, 0.7].map((x) => (
        <mesh key={x} position={[x, 0.9, isBus ? 3.75 : 2.85]}>
          <boxGeometry args={[0.4, 0.18, 0.08]} />
          <meshBasicMaterial color={obj.oncoming ? '#ff9944' : '#f0f6ff'} transparent opacity={0.9 * op} />
        </mesh>
      ))}
      <WheelSet
        c={c}
        op={op}
        width={2.4}
        zs={isBus ? [2.5, 0.3, -2.4] : [1.7, -2.5]}
        y={0.45}
        r={0.45}
      />
    </group>
  )
}

function MotoMesh({
  c,
  op,
  obj,
  yaw,
}: {
  c: Palette
  op: number
  obj: WorldObject
  yaw: number
}) {
  return (
    <group position={[obj.displayX, 0, -obj.displayZ]} rotation={[0, yaw, 0]}>
      <GroundGlow color={c.glow} opacity={0.2 * op} radius={0.75} />
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[0.42, 0.5, 1.75]} />
        <meshStandardMaterial color={c.body} transparent opacity={0.96 * op} roughness={0.35} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0.95, -0.2]} castShadow>
        <boxGeometry args={[0.38, 0.48, 0.55]} />
        <meshStandardMaterial color={c.cabin} transparent opacity={0.95 * op} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.85, 0.35]} rotation={[-0.5, 0, 0]}>
        <boxGeometry args={[0.35, 0.35, 0.05]} />
        <meshStandardMaterial color={c.glass} transparent opacity={0.7 * op} />
      </mesh>
      {[0.55, -0.55].map((z) => (
        <mesh key={z} position={[0, 0.32, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.28, 0.28, 0.14, 16]} />
          <meshStandardMaterial color={c.tire} transparent opacity={0.96 * op} />
        </mesh>
      ))}
    </group>
  )
}

function WheelSet({
  c,
  op,
  width,
  zs,
  y,
  r,
}: {
  c: Palette
  op: number
  width: number
  zs: number[]
  y: number
  r: number
}) {
  const x = width / 2 - 0.1
  return (
    <group>
      {zs.flatMap((z) =>
        [-x, x].map((wx) => (
          <group key={`${wx}-${z}`} position={[wx, y, z]}>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[r, r, 0.24, 14]} />
              <meshStandardMaterial color={c.tire} transparent opacity={0.96 * op} roughness={0.85} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[r * 0.55, r * 0.55, 0.26, 12]} />
              <meshStandardMaterial color={c.wheel} transparent opacity={0.95 * op} metalness={0.5} roughness={0.35} />
            </mesh>
          </group>
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
    <>
      {/* Outer glow */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius * 1.2, 32]} />
        <meshBasicMaterial 
          color={color} 
          transparent 
          opacity={opacity * 0.3} 
          depthWrite={false} 
        />
      </mesh>
      {/* Inner glow */}
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[radius * 0.7, 32]} />
        <meshBasicMaterial 
          color={color} 
          transparent 
          opacity={opacity * 0.8} 
          depthWrite={false} 
        />
      </mesh>
    </>
  )
}

function PersonProxy({ obj }: { obj: WorldObject }) {
  const op = 0.96 * obj.opacity
  const body = '#a8b8c8'
  const accent = '#7a8a9c'

  return (
    <group position={[obj.displayX, 0, -obj.displayZ]}>
      <GroundGlow color="#5a8ab8" opacity={0.28 * obj.opacity} radius={0.45} />
      <mesh position={[-0.11, 0.42, 0]} castShadow>
        <capsuleGeometry args={[0.07, 0.5, 3, 6]} />
        <meshStandardMaterial 
          color={accent} 
          transparent 
          opacity={op} 
          roughness={0.6} 
          metalness={0.05}
          envMapIntensity={0.4}
        />
      </mesh>
      <mesh position={[0.11, 0.42, 0]} castShadow>
        <capsuleGeometry args={[0.07, 0.5, 3, 6]} />
        <meshStandardMaterial 
          color={accent} 
          transparent 
          opacity={op} 
          roughness={0.6}
          metalness={0.05}
          envMapIntensity={0.4}
        />
      </mesh>
      <mesh position={[0, 1.05, 0]} castShadow>
        <capsuleGeometry args={[0.18, 0.55, 3, 8]} />
        <meshStandardMaterial 
          color={body} 
          transparent 
          opacity={op} 
          roughness={0.5}
          metalness={0.05}
          envMapIntensity={0.4}
        />
      </mesh>
      <mesh position={[-0.28, 1.05, 0]} rotation={[0.1, 0, 0.15]}>
        <capsuleGeometry args={[0.055, 0.4, 3, 6]} />
        <meshStandardMaterial 
          color={body} 
          transparent 
          opacity={op} 
          roughness={0.55}
          metalness={0.05}
          envMapIntensity={0.4}
        />
      </mesh>
      <mesh position={[0.28, 1.05, 0]} rotation={[0.1, 0, -0.15]}>
        <capsuleGeometry args={[0.055, 0.4, 3, 6]} />
        <meshStandardMaterial 
          color={body} 
          transparent 
          opacity={op} 
          roughness={0.55}
          metalness={0.05}
          envMapIntensity={0.4}
        />
      </mesh>
      <mesh position={[0, 1.68, 0]} castShadow>
        <sphereGeometry args={[0.15, 12, 12]} />
        <meshStandardMaterial 
          color={body} 
          transparent 
          opacity={op} 
          roughness={0.45}
          metalness={0.05}
          envMapIntensity={0.4}
        />
      </mesh>
    </group>
  )
}

function TrafficLightProxy({ obj }: { obj: WorldObject }) {
  const lit = obj.signal ?? 'off'
  const lamp = (which: 'red' | 'amber' | 'green', y: number, color: string) => {
    const on = lit === which
    return (
      <mesh key={which} position={[0, 3.35 + y, 0.14]}>
        <circleGeometry args={[0.11, 14]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={(on ? 1 : 0.18) * obj.opacity}
        />
      </mesh>
    )
  }

  return (
    <group position={[obj.displayX, 0, -obj.displayZ]}>
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 3.2, 8]} />
        <meshStandardMaterial color="#5a6068" transparent opacity={0.95 * obj.opacity} />
      </mesh>
      <mesh position={[0, 3.35, 0]}>
        <boxGeometry args={[0.42, 1.1, 0.3]} />
        <meshStandardMaterial color="#2e3238" transparent opacity={0.95 * obj.opacity} />
      </mesh>
      {lamp('red', 0.32, '#ff3333')}
      {lamp('amber', 0, '#ffbb33')}
      {lamp('green', -0.32, '#33dd66')}
      {lit !== 'off' && (
        <>
          <pointLight
            position={[0, 3.35, 0.5]}
            color={lit === 'red' ? '#ff4444' : lit === 'amber' ? '#ffbb33' : '#44ee77'}
            intensity={3.5 * obj.opacity}
            distance={15}
            decay={2}
          />
          {/* Additional ambient glow for the lit signal */}
          <pointLight
            position={[0, 3.35, 0.3]}
            color={lit === 'red' ? '#ff6666' : lit === 'amber' ? '#ffcc66' : '#66ff99'}
            intensity={1.5 * obj.opacity}
            distance={8}
            decay={2}
          />
        </>
      )}
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
