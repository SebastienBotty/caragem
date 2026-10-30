'use client';
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { User } from '@/lib/domain';
import type { garageSite } from '@/lib/layout';
import { Box, Plant } from './garage-primitives';
import { Floor } from './garage-environment';
import { Mechanic } from './mechanic';

function PoolTable() {
  const balls: [number, number, string][] = [
    [0.2, -0.8, '#f1db5e'],
    [0.04, -0.62, '#c95740'],
    [0.35, -0.62, '#dfe4e2'],
    [-0.45, 0.85, '#f5f1df'],
  ];
  return (
    <group position={[-2, 0, 0.3]}>
      {[-0.95, 0.95].flatMap((x) =>
        [-1.3, 1.3].map((z) => (
          <Box key={`${x}-${z}`} position={[x, 0.48, z]} size={[0.2, 0.9, 0.2]} color="#5e4634" />
        )),
      )}
      <Box position={[0, 0.95, 0]} size={[2.6, 0.32, 3.7]} color="#765137" />
      <Box position={[0, 1.13, 0]} size={[2.28, 0.07, 3.38]} color="#2c856b" />
      {[-1.12, 1.12].flatMap((x) =>
        [-1.65, 0, 1.65].map((z) => (
          <mesh key={`${x}-${z}`} position={[x, 1.18, z]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.13, 12]} />
            <meshBasicMaterial color="#172e29" />
          </mesh>
        )),
      )}
      {balls.map(([x, z, color]) => (
        <mesh key={color} position={[x, 1.23, z]} castShadow>
          <sphereGeometry args={[0.075, 10, 8]} />
          <meshStandardMaterial color={color} roughness={0.35} />
        </mesh>
      ))}
      <Box
        position={[0.85, 1.23, 0.25]}
        rotation={[0, 0.12, 0]}
        size={[0.035, 0.035, 2.6]}
        color="#d9b27a"
      />
    </group>
  );
}

function BreakTable({ z }: { z: number }) {
  return (
    <group position={[2, 0, z]}>
      <Box position={[0, 0.84, 0]} size={[1.45, 0.12, 1.2]} color="#cead7d" />
      <Box position={[0, 0.4, 0]} size={[0.12, 0.8, 0.12]} color="#45534e" />
      <Box position={[0, 0.07, 0]} size={[0.75, 0.1, 0.7]} color="#45534e" />
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 1.1, 0, 0]}>
          <Box position={[0, 0.45, 0]} size={[0.6, 0.12, 0.65]} color="#657f77" />
          <Box position={[side * 0.24, 0.85, 0]} size={[0.12, 0.7, 0.65]} color="#657f77" />
          {[-0.22, 0.22].flatMap((x) =>
            [-0.23, 0.23].map((dz) => (
              <Box
                key={`${x}-${dz}`}
                position={[x, 0.21, dz]}
                size={[0.05, 0.42, 0.05]}
                color="#45534e"
              />
            )),
          )}
        </group>
      ))}
      <mesh position={[0.25, 1, 0.2]}>
        <cylinderGeometry args={[0.09, 0.08, 0.2, 10]} />
        <meshStandardMaterial color="#f4eee1" />
      </mesh>
      <Box
        position={[-0.2, 0.92, -0.15]}
        size={[0.32, 0.025, 0.4]}
        rotation={[0, 0.2, 0]}
        color="#e6ded1"
      />
    </group>
  );
}

function VendingMachine() {
  return (
    <group position={[-3.6, 0, -3.1]}>
      <Box position={[0, 1.18, 0]} size={[1.45, 2.35, 1]} color="#b34c3c" />
      <Box position={[-0.18, 1.48, 0.515]} size={[0.85, 1.25, 0.04]} color="#263f48" />
      {[0.98, 1.38, 1.78].flatMap((y, row) =>
        [-0.43, -0.16, 0.11].map((x, i) => (
          <Box
            key={`${x}-${y}`}
            position={[x, y, 0.56]}
            size={[0.17, 0.25, 0.09]}
            color={['#e6c55c', '#77a3bf', '#dc9171'][(row + i) % 3]}
          />
        )),
      )}
      <Box position={[0.5, 1.5, 0.55]} size={[0.2, 0.3, 0.04]} color="#acdcbd" />
      <Box position={[0, 0.4, 0.52]} size={[0.95, 0.3, 0.05]} color="#263139" />
      <Box position={[0, 2.2, 0.53]} size={[1.2, 0.13, 0.04]} color="#efdec3" />
    </group>
  );
}

export function BreakRoom({
  room,
  mechanics,
  animate,
  onFocus,
}: {
  room: ReturnType<typeof garageSite>['lounge'];
  mechanics: User[];
  animate: boolean;
  onFocus: () => void;
}) {
  const { gl } = useThree();
  const spots = [
    [-2, 2.8, Math.PI],
    [-0.1, 0.1, -Math.PI / 2],
    [3.9, 1.8, -Math.PI / 2],
    [-4.1, 0.2, Math.PI / 2],
  ];
  return (
    <group position={[room.x, 0.06, room.z]}>
      <Floor width={room.width} depth={room.depth} color="#c8b091" />
      <Box position={[0, 1.8, -4]} size={[10, 3.6, 0.25]} color="#a5b3a0" />
      <Box position={[-5, 1.8, 0]} size={[0.25, 3.6, 8]} color="#b9b7a4" />
      <Box position={[0, 3.65, -4]} size={[10.3, 0.2, 0.45]} color="#465751" />
      <Box position={[-5, 3.65, 0]} size={[0.4, 0.2, 8]} color="#465751" />
      <Box position={[0, 0.18, 4]} size={[10, 0.3, 0.2]} color="#bdac92" />
      <Box position={[5, 0.18, 0]} size={[0.2, 0.3, 8]} color="#bdac92" />
      <PoolTable />
      <BreakTable z={1.8} />
      <BreakTable z={-1.6} />
      <VendingMachine />
      <group position={[2, 2.25, -3.8]}>
        <Box position={[0, 0, 0]} size={[2.6, 1.5, 0.15]} color="#263437" />
        <mesh position={[0, 0, 0.085]}>
          <planeGeometry args={[2.35, 1.26]} />
          <meshStandardMaterial color="#629ba9" emissive="#497e8b" emissiveIntensity={0.45} />
        </mesh>
        <Box position={[0, -0.27, 0.1]} size={[2.35, 0.42, 0.025]} color="#508567" />
        <Box position={[-0.5, 0.1, 0.11]} size={[0.62, 0.35, 0.025]} color="#e3bf77" />
        <Box position={[0, -0.68, 0.11]} size={[0.04, 0.02, 0.01]} color="#92ce92" />
      </group>
      <Plant x={4.3} z={-3.2} scale={0.65} />
      <Html
        portal={{ current: gl.domElement.parentElement! }}
        position={[-0.7, 3.1, -3.7]}
        center
        transform
        distanceFactor={13}
        zIndexRange={[10, 0]}
      >
        <button
          className="building-sign room-sign"
          onClick={onFocus}
          aria-label="Voir la salle de repos"
          style={{ background: '#526f64', cursor: 'pointer' }}
        >
          SALLE DE REPOS · {mechanics.length}
        </button>
      </Html>
      {mechanics.map((user, index) => {
        const [x, z, angle] = spots[index] ?? [
          -4 + ((index - 4) % 6) * 1.5,
          3.2 - Math.floor((index - 4) / 6) * 1.1,
          Math.PI,
        ];
        return (
          <group key={user.id} position={[x, 0, z]} rotation={[0, angle, 0]}>
            <Mechanic
              index={index}
              color={user.color}
              name={user.name}
              avatar={user.avatar}
              animate={animate}
              resting
            />
          </group>
        );
      })}
    </group>
  );
}
