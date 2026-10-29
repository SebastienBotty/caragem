'use client';
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

const red = new THREE.Color('#dc2626');
const yellow = new THREE.Color('#facc15');

export function VehiclePriority({ animate }: { animate: boolean }) {
  const marker = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>>(null);
  const { gl } = useThree();
  useFrame(({ clock }) => {
    // One smooth pulse every 1.8 seconds, with a static alert when motion is reduced.
    const wave = animate ? Math.sin((clock.elapsedTime * Math.PI * 2) / 1.8) : 0;
    const pulse = animate ? (wave + 1) / 2 : 0;
    if (marker.current) marker.current.position.y = 2.8 + wave * 0.18;
    if (ring.current) {
      ring.current.material.color.copy(red).lerp(yellow, pulse);
      ring.current.material.opacity = 0.6 + pulse * 0.3;
      ring.current.scale.setScalar(1 + pulse * 0.04);
    }
  });
  return (
    <>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} raycast={() => {}}>
        <ringGeometry args={[1.95, 2.08, 48]} />
        <meshBasicMaterial
          color="#dc2626"
          transparent
          opacity={0.8}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <group ref={marker} position={[0, 2.8, 0]}>
        <Html
          portal={{ current: gl.domElement.parentElement! }}
          center
          zIndexRange={[16, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <span
            role="img"
            aria-label="Véhicule prioritaire"
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 30,
              height: 30,
              color: '#dc2626',
              fontSize: 28,
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            !
          </span>
        </Html>
      </group>
    </>
  );
}
