import type { SceneExtras } from '../world/types'

/** Soft Tesla-style facade massing along the roadside. */
export function UrbanSurroundings({ extras }: { extras: SceneExtras }) {
  if (!extras.urban || !extras.buildings.length) return null

  return (
    <group>
      {extras.buildings.map((b, i) => (
        <mesh
          key={`${b.side}-${i}-${b.z}`}
          position={[b.x, b.height / 2, -b.z]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[b.width, b.height, b.depth]} />
          <meshStandardMaterial
            color={b.side < 0 ? '#b8bcc4' : '#c4c8d0'}
            roughness={0.92}
            metalness={0.05}
            transparent
            opacity={0.88}
          />
        </mesh>
      ))}
      {/* Sidewalk strips */}
      {([-1, 1] as const).map((side) => (
        <mesh
          key={`walk-${side}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[side * 7.2, 0.02, -40]}
          receiveShadow
        >
          <planeGeometry args={[2.4, 90]} />
          <meshStandardMaterial color="#aeb4bc" roughness={1} />
        </mesh>
      ))}
    </group>
  )
}

/** Zebra / pelican crossing stripes across the carriageway. */
export function ZebraCrossing({
  zebra,
  roadHalfWidth,
}: {
  zebra: NonNullable<SceneExtras['zebra']>
  roadHalfWidth: number
}) {
  const stripes = 9
  const stripeW = zebra.width / stripes
  const half = Math.max(3.5, roadHalfWidth)

  return (
    <group position={[0, 0.06, -zebra.z]}>
      {Array.from({ length: stripes }, (_, i) => {
        const x = -half + stripeW * (i + 0.5)
        return (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0, 0]}>
            <planeGeometry args={[stripeW * 0.72, 2.8]} />
            <meshBasicMaterial
              color="#f2f4f7"
              transparent
              opacity={0.92 * zebra.opacity}
              depthWrite={false}
            />
          </mesh>
        )
      })}
    </group>
  )
}
