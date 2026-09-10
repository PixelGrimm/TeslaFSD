import type { SceneExtras } from '../world/types'

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
      {/* Shadow/glow underneath for visibility */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[half * 2, 3.2]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.12 * zebra.opacity}
          depthWrite={false}
        />
      </mesh>
      
      {Array.from({ length: stripes }, (_, i) => {
        const x = -half + stripeW * (i + 0.5)
        return (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0, 0]}>
            <planeGeometry args={[stripeW * 0.72, 2.8]} />
            <meshBasicMaterial
              color="#ffffff"
              transparent
              opacity={0.98 * zebra.opacity}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        )
      })}
    </group>
  )
}
