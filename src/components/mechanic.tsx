'use client';
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { Box } from './garage-primitives';

export function Mechanic({
  index,
  color,
  name,
  animate,
  resting = false,
}: {
  index: number;
  color: string;
  name: string;
  animate: boolean;
  resting?: boolean;
}) {
  const body = useRef<THREE.Group>(null);
  const arm = useRef<THREE.Group>(null);
  const side = index % 2 ? -1 : 1;
  const label = useRef<HTMLSpanElement>(null);
  const { gl } = useThree();
  useFrame(({ clock }) => {
    const t = animate ? clock.elapsedTime * 3 + index * 1.7 : 0;
    if (body.current)
      body.current.rotation.x = resting ? Math.sin(t) * 0.015 : 0.12 + Math.sin(t) * 0.035;
    if (arm.current) arm.current.rotation.x = resting ? 0.05 : -0.9 + Math.sin(t) * 0.22;
    if (label.current)
      label.current.style.visibility =
        body.current?.parent?.parent?.visible === false ? 'hidden' : 'visible';
  });
  return (
    <group
      position={resting ? [0, 0.06, 0] : [side * 1.45, 0.12, 1.25 - Math.floor(index / 2) * 1.1]}
      rotation={[0, resting ? 0 : (-side * Math.PI) / 2, 0]}
    >
      <Html
        portal={{ current: gl.domElement.parentElement! }}
        position={[0, 2.25 + (index % 2) * 0.55, 0]}
        center
        zIndexRange={[15, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <span ref={label} className="mechanic-name" data-location={resting ? 'lounge' : 'work'}>
          <i style={{ background: color }} />
          {name}
        </span>
      </Html>
      {[-0.14, 0.14].map((x) => (
        <group key={x}>
          <Box position={[x, 0.38, 0]} size={[0.19, 0.66, 0.24]} color="#283c50" />
          <Box position={[x, 0.08, 0.07]} size={[0.23, 0.15, 0.37]} color="#242b31" />
        </group>
      ))}
      <group ref={body} position={[0, 0.7, 0]}>
        <RoundedBox args={[0.53, 0.62, 0.32]} radius={0.09} position={[0, 0.28, 0]} castShadow>
          <meshStandardMaterial color={color} />
        </RoundedBox>
        <Box position={[0, 0.29, 0.17]} size={[0.23, 0.3, 0.035]} color="#324c64" />
        <mesh castShadow position={[0, 0.86, 0.025]}>
          <sphereGeometry args={[0.21, 10, 8]} />
          <meshStandardMaterial color="#d7a47f" />
        </mesh>
        <mesh position={[0, 0.98, 0.01]}>
          <sphereGeometry args={[0.22, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#2f4257" />
        </mesh>
        <Box position={[0, 0.98, 0.18]} size={[0.32, 0.04, 0.23]} color="#2f4257" />
        <group ref={arm} position={[-0.34, 0.48, 0]} rotation={[-0.9, 0, -0.12]}>
          <Box position={[0, -0.18, 0]} size={[0.17, 0.38, 0.18]} color={color} />
          <Box position={[0, -0.4, 0.03]} size={[0.15, 0.13, 0.16]} color="#d7a47f" />
          {!resting && (
            <>
              <Box position={[0, -0.44, 0.16]} size={[0.06, 0.06, 0.38]} color="#bdc8d0" />
              <mesh position={[0, -0.44, 0.36]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.075, 0.025, 5, 8]} />
                <meshStandardMaterial color="#bdc8d0" metalness={0.7} roughness={0.3} />
              </mesh>
            </>
          )}
        </group>
        <group position={[0.34, 0.46, 0]} rotation={[resting ? 0.05 : -0.8, 0, 0.15]}>
          <Box position={[0, -0.2, 0]} size={[0.17, 0.4, 0.18]} color={color} />
          <Box position={[0, -0.44, 0]} size={[0.15, 0.13, 0.16]} color="#d7a47f" />
        </group>
      </group>
    </group>
  );
}
