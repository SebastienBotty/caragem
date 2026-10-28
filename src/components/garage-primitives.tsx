'use client';
import type { ComponentProps } from 'react';
export function Box({
  position,
  size,
  color,
  ...props
}: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
} & Partial<ComponentProps<'mesh'>>) {
  return (
    <mesh castShadow receiveShadow position={position} {...props}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.75} />
    </mesh>
  );
}
export function Plant({ x, z, scale = 1 }: { x: number; z: number; scale?: number }) {
  return (
    <group position={[x, 0.12, z]} scale={scale}>
      <mesh castShadow position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.42, 0.32, 0.6, 8]} />
        <meshStandardMaterial color="#b29d83" />
      </mesh>
      <Box position={[0, 0.95, 0]} size={[0.15, 1.4, 0.15]} color="#7c7157" />
      <mesh castShadow position={[0, 1.6, 0]}>
        <icosahedronGeometry args={[0.9, 1]} />
        <meshStandardMaterial color="#638544" flatShading />
      </mesh>
      <mesh castShadow position={[0.35, 2.1, 0.1]}>
        <icosahedronGeometry args={[0.6, 0]} />
        <meshStandardMaterial color="#8a9f4d" flatShading />
      </mesh>
    </group>
  );
}
export function ToolBench({ x, z, width = 1.8 }: { x: number; z: number; width?: number }) {
  return (
    <group position={[x, 0.15, z]}>
      <Box position={[0, 0.65, 0]} size={[width, 1.05, 0.65]} color="#ad493c" />
      <Box position={[0, 1.2, 0]} size={[width + 0.12, 0.12, 0.82]} color="#48515b" />
      {[0.35, 0.65, 0.95].map((y) => (
        <group key={y}>
          <Box position={[0, y, 0.34]} size={[width - 0.12, 0.025, 0.035]} color="#7c3c35" />
          <Box position={[0, y + 0.1, 0.36]} size={[width * 0.5, 0.035, 0.04]} color="#c2c5c4" />
        </group>
      ))}
      {[-0.4, 0.4].map((x) => (
        <mesh key={x} position={[x, 0.1, 0.12]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.12, 0.12, 0.12, 8]} />
          <meshStandardMaterial color="#30383f" />
        </mesh>
      ))}
      <Box position={[-0.35, 1.36, 0]} size={[0.26, 0.22, 0.18]} color="#cdab53" />
      <Box position={[0.25, 1.31, 0.1]} size={[0.4, 0.06, 0.18]} color="#8d9ba9" />
    </group>
  );
}
export function TireStack({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.2, z]}>
      {[0, 0.23, 0.46].map((y) => (
        <mesh castShadow key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.38, 0.14, 7, 16]} />
          <meshStandardMaterial color="#343b40" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}
