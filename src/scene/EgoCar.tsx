import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { Group } from 'three'
import type { EgoMotion } from '../world/types'

interface EgoCarProps {
  motion: EgoMotion
}

useGLTF.preload('/models/ego-car.glb')

const TARGET_LENGTH_M = 4.9 // Opel Insignia Grand Sport ~4898 mm

/**
 * Ego vehicle from local Opel Insignia Grand Sport 2020 GLB.
 * Auto-fits length, seats on the road, faces forward (-Z).
 */
export function EgoCar({ motion }: EgoCarProps) {
  const { scene } = useGLTF('/models/ego-car.glb')
  const spinRef = useRef<Group>(null)

  const { object, groundY } = useMemo(() => {
    const root = scene.clone(true)

    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
        // Slightly brighten body paint for the light Tesla-style viz
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const mat of mats) {
          const m = mat as THREE.MeshStandardMaterial
          if (!m?.isMeshStandardMaterial) continue
          if (m.name === 'body') {
            m.metalness = Math.max(m.metalness ?? 0.4, 0.55)
            m.roughness = Math.min(m.roughness ?? 0.4, 0.35)
            m.needsUpdate = true
          }
        }
      }
    })

    // Bake current world transforms into a measurement box
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())

    // Center horizontally; keep relative Y for ground seating after scale
    root.position.x -= center.x
    root.position.z -= center.z
    root.position.y -= box.min.y

    // Length is the longer horizontal axis
    const length = Math.max(size.x, size.z)
    const scale = length > 0.001 ? TARGET_LENGTH_M / length : 1
    root.scale.setScalar(scale)

    // If the model’s long axis is X, yaw so length runs along Z
    const yaw = size.x > size.z ? Math.PI / 2 : 0

    // Face road forward (-Z). Extra PI if the mesh’s nose points +Z.
    const face = Math.PI

    const wrapper = new THREE.Group()
    wrapper.rotation.y = yaw + face
    wrapper.add(root)

    return { object: wrapper, groundY: 0 }
  }, [scene])

  useEffect(() => {
    return () => {
      object.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.isMesh) {
          mesh.geometry?.dispose?.()
        }
      })
    }
  }, [object])

  // Subtle idle-free; only tiny motion cue when driving (model has no separate wheels)
  useFrame((_, dt) => {
    if (!spinRef.current) return
    if (motion.moving && motion.speedMps > 1) {
      spinRef.current.position.y = groundY + Math.sin(performance.now() * 0.01) * 0.004
    } else {
      spinRef.current.position.y = groundY
    }
    void dt
  })

  return (
    <group>
      <group ref={spinRef} position={[0, groundY, 0]}>
        <primitive object={object} />
      </group>

      <mesh position={[-0.55, 0.03, -3.6]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.15, 28]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <mesh position={[0.55, 0.03, -3.6]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.15, 28]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.16} depthWrite={false} />
      </mesh>
    </group>
  )
}
