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
      {Array.from({ length: stripes }, (_, i) => {
        const x = -half + stripeW * (i + 0.5)
        return (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0, 0]} receiveShadow>
            <planeGeometry args={[stripeW * 0.72, 2.8]} />
            <meshStandardMaterial
              color="#f8fafb"
              transparent
              opacity={0.96 * zebra.opacity}
              depthWrite={false}
              roughness={0.7}
              metalness={0.05}
              envMapIntensity={0.4}
            />
          </mesh>
        )
      })}
    </group>
  )
}
