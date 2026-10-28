'use client';
import { useLayoutEffect, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { circulationWidth, garageSite, type ZoneLayout } from '@/lib/layout';
import { Box, Plant, TireStack, ToolBench } from './garage-primitives';
import { Mechanic } from './mechanic';
import type { User } from '@/lib/domain';

const steel = '#3d4855',
  plaster = '#b6aa96';

export function Floor({
  width,
  depth,
  color = '#b5aca0',
}: {
  width: number;
  depth: number;
  color?: string;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const cols = Math.ceil(width / 1.6),
    rows = Math.ceil(depth / 1.6);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const matrix = new THREE.Matrix4();
    const tint = new THREE.Color(color);
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        matrix.makeTranslation(
          -width / 2 + ((i + 0.5) * width) / cols,
          0.015,
          -depth / 2 + ((j + 0.5) * depth) / rows,
        );
        ref.current.setMatrixAt(j * cols + i, matrix);
        ref.current.setColorAt(
          j * cols + i,
          tint.clone().multiplyScalar(0.93 + ((i * 7 + j * 3) % 5) * 0.025),
        );
      }
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [width, depth, color, cols, rows]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, cols * rows]} receiveShadow>
      <boxGeometry args={[width / cols - 0.025, 0.025, depth / rows - 0.025]} />
      <meshStandardMaterial roughness={0.95} />
    </instancedMesh>
  );
}

function Bollard({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.08, z]}>
      <Box position={[0, 0.58, 0]} size={[0.23, 1.16, 0.23]} color="#e8b834" />
      <Box position={[0, 0.75, 0.125]} size={[0.24, 0.22, 0.025]} color={steel} />
      <Box position={[0, 0.06, 0]} size={[0.42, 0.12, 0.42]} color={steel} />
    </group>
  );
}

function WallLight({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 3.8, z]}>
      <Box position={[0, 0.05, 0]} size={[1.5, 0.22, 0.22]} color={steel} />
      <mesh position={[0, -0.08, 0.06]}>
        <boxGeometry args={[1.3, 0.08, 0.19]} />
        <meshStandardMaterial color="#ffe6ae" emissive="#ffe0a3" emissiveIntensity={2} />
      </mesh>
    </group>
  );
}

function Shelf({ x, z, width = 2 }: { x: number; z: number; width?: number }) {
  return (
    <group position={[x, 0.1, z]}>
      {[-1, 1].map((side) => (
        <Box
          key={side}
          position={[(side * width) / 2, 1.3, 0]}
          size={[0.09, 2.6, 0.7]}
          color={steel}
        />
      ))}
      {[0.2, 1.05, 1.9, 2.6].map((y, row) => (
        <group key={y}>
          <Box position={[0, y, 0]} size={[width + 0.1, 0.09, 0.8]} color="#606971" />
          {row < 3 &&
            [-0.28, 0.25].map((offset, i) => (
              <group key={offset}>
                <Box
                  position={[width * offset, y + 0.28, 0.02]}
                  size={[width * 0.38, 0.48, 0.58]}
                  color={i ? '#b58e51' : '#cfa568'}
                />
                <Box
                  position={[width * offset, y + 0.28, 0.32]}
                  size={[width * 0.12, 0.17, 0.015]}
                  color="#eee1bf"
                />
              </group>
            ))}
        </group>
      ))}
    </group>
  );
}

export function BayEquipment({ x, z, diagnostic }: { x: number; z: number; diagnostic: boolean }) {
  return (
    <group position={[x, 0.1, z]}>
      <ToolBench x={0.8} z={0} width={1.1} />
      <Box position={[0.8, 1.96, -0.3]} size={[1.35, 1.15, 0.1]} color={steel} />
      {[-0.4, 0, 0.4].map((dx, i) => (
        <group key={dx}>
          <Box
            position={[0.8 + dx, 2.02, -0.22]}
            size={[0.045, 0.48 - i * 0.06, 0.06]}
            color="#c6c8bf"
          />
          <mesh position={[0.8 + dx, 2.28 - i * 0.03, -0.2]}>
            <torusGeometry args={[0.075, 0.025, 5, 8]} />
            <meshStandardMaterial color="#c6c8bf" />
          </mesh>
        </group>
      ))}
      <group position={[-1.1, 0, -0.05]}>
        <Box
          position={[0, 0.9, 0]}
          size={[0.58, 1.8, 0.55]}
          color={diagnostic ? '#45627a' : '#53626e'}
        />
        <Box position={[0, 1.38, 0.29]} size={[0.4, 0.48, 0.03]} color="#283844" />
        <Box position={[0.15, 0.84, 0.3]} size={[0.045, 0.24, 0.04]} color="#ccd3cf" />
        <Box position={[0, 0.18, 0.29]} size={[0.45, 0.03, 0.04]} color="#283844" />
      </group>
      {diagnostic ? (
        <group position={[-0.8, 0, 1]}>
          <Box position={[0, 0.15, 0]} size={[0.6, 0.12, 0.55]} color={steel} />
          <Box position={[0, 0.8, 0]} size={[0.12, 1.3, 0.12]} color={steel} />
          <Box position={[0, 1.4, 0]} size={[0.86, 0.55, 0.1]} color={steel} />
          <Box position={[0, 1.4, 0.06]} size={[0.7, 0.4, 0.025]} color="#83c7ca" />
        </group>
      ) : (
        <group position={[-0.35, 0.5, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.22, 0.22, 0.65, 12]} />
            <meshStandardMaterial color="#bb4c34" />
          </mesh>
          <Box position={[0, 0.3, 0]} size={[0.3, 0.18, 0.24]} color={steel} />
          <mesh position={[0.15, 0.6, -0.25]}>
            <torusGeometry args={[0.24, 0.035, 6, 18]} />
            <meshStandardMaterial color="#292e32" />
          </mesh>
        </group>
      )}
    </group>
  );
}

export function WorkshopShell({ zone }: { zone: ZoneLayout }) {
  const rear = -zone.depth / 2,
    left = -zone.width / 2;
  const sections = Math.ceil(zone.width / 4.5);
  return (
    <group position={[zone.x, 0, zone.z]}>
      <Floor width={zone.width} depth={zone.depth} />
      <Box position={[0, 2.35, rear]} size={[zone.width + 0.25, 4.7, 0.28]} color={plaster} />
      <Box position={[0, 0.6, rear + 0.16]} size={[zone.width, 1.2, 0.08]} color="#7b807e" />
      <Box position={[left, 2.35, 0]} size={[0.28, 4.7, zone.depth]} color={plaster} />
      <Box position={[left + 0.16, 0.6, 0]} size={[0.08, 1.2, zone.depth]} color="#7b807e" />
      <Box position={[0, 4.72, rear]} size={[zone.width + 0.4, 0.25, 0.55]} color={steel} />
      <Box position={[left, 4.72, 0]} size={[0.5, 0.25, zone.depth]} color={steel} />
      <Box position={[0, 4.58, rear + 0.55]} size={[zone.width, 0.16, 1.15]} color="#5f6d7a" />
      {[1.3, 2.25, 3.2, 4.15].map((y) => (
        <Box
          key={y}
          position={[0, y, rear + 0.15]}
          size={[zone.width, 0.018, 0.015]}
          color="#978f82"
        />
      ))}
      {Array.from({ length: sections }, (_, i) => {
        const x = left + ((i + 0.5) * zone.width) / sections;
        return (
          <group key={i}>
            <Box position={[x, 3.38, rear + 0.19]} size={[2.7, 0.7, 0.12]} color={steel} />
            <Box position={[x, 3.38, rear + 0.26]} size={[2.48, 0.51, 0.04]} color="#b2d4db" />
            <Box position={[x, 3.38, rear + 0.3]} size={[0.05, 0.56, 0.03]} color={steel} />
            <WallLight x={x} z={rear + 0.28} />
            <Box
              position={[left + (i * zone.width) / sections, 2.35, rear + 0.23]}
              size={[0.18, 4.7, 0.28]}
              color={steel}
            />
          </group>
        );
      })}
      {[-1, 1].map((side) => (
        <group key={side}>
          <Box
            position={[side * (zone.width / 2 - 0.15), 2.3, zone.depth / 2]}
            size={[0.24, 4.6, 0.32]}
            color={steel}
          />
          <Bollard x={side * (zone.width / 2 - 0.45)} z={zone.depth / 2 + 0.1} />
        </group>
      ))}
      {[-1, 1].map((side) => (
        <Box
          key={side}
          position={[side * (zone.width / 2 - 0.6), 4.55, zone.depth / 2]}
          size={[1.2, 0.24, 0.42]}
          color={steel}
        />
      ))}
      <Box position={[left + 0.25, 1.3, 1]} size={[0.18, 0.75, 0.3]} color="#bd4635" />
    </group>
  );
}

export function ParkingEdge({ zone }: { zone: ZoneLayout }) {
  const back = zone.z + zone.depth / 2;
  return (
    <group>
      <Box position={[zone.x, 0.12, back]} size={[zone.width, 0.24, 0.3]} color="#c8c4b5" />
      {[-1, 1].map((side) => (
        <Bollard key={side} x={zone.x + side * (zone.width / 2 - 0.45)} z={back - 0.4} />
      ))}
      <Plant x={zone.x + zone.width / 2 - 0.65} z={back - 0.85} scale={0.8} />
    </group>
  );
}

export function ServiceWing({
  site,
  onOpenStock,
  owners,
}: {
  site: ReturnType<typeof garageSite>;
  onOpenStock: () => void;
  owners: User[];
}) {
  const { gl } = useThree();
  // Keep the labels in the same DOM container while Canvas connects its event target.
  const portal = { current: gl.domElement.parentElement! };
  const { x, z, width, depth } = site.service;
  const stock = width * 0.39;
  const divider = -width / 2 + stock;
  const office = width - stock;
  const officeX = divider + office / 2;
  return (
    <group position={[x, 0.06, z]}>
      <Floor width={width} depth={depth} color="#c79d69" />
      <Box position={[0, 2, -depth / 2]} size={[width, 4, 0.25]} color={plaster} />
      <Box position={[-width / 2, 2, 0]} size={[0.25, 4, depth]} color={plaster} />
      <Box position={[divider, 1.8, 0]} size={[0.22, 3.6, depth]} color={plaster} />
      <Box position={[divider, 3.65, 0]} size={[0.4, 0.18, depth]} color={steel} />
      <Box position={[0, 4.05, -depth / 2]} size={[width + 0.35, 0.25, 0.5]} color={steel} />
      <Box position={[-width / 2, 4.05, 0]} size={[0.45, 0.25, depth]} color={steel} />
      <Box position={[0, 3.95, -depth / 2 + 0.45]} size={[width, 0.15, 1]} color="#63707a" />
      <group
        onClick={(e) => {
          e.stopPropagation();
          onOpenStock();
        }}
      >
        <Shelf x={-width / 2 + stock / 2} z={-depth / 2 + 0.65} width={stock - 1} />
        <Shelf x={-width / 2 + 1.2} z={0} width={1.7} />
        <TireStack x={divider - 1} z={0.2} />
        <TireStack x={divider - 1} z={1.4} />
      </group>
      <Box
        position={[-width / 2 + stock / 2, 3.4, depth / 2]}
        size={[stock - 0.5, 0.85, 0.22]}
        color="#68717a"
      />
      {[3.08, 3.3, 3.52, 3.74].map((y) => (
        <Box
          key={y}
          position={[-width / 2 + stock / 2, y, depth / 2 + 0.13]}
          size={[stock - 0.6, 0.035, 0.04]}
          color="#444e5b"
        />
      ))}
      {[-width / 2, divider].map((dx) => (
        <group key={dx}>
          <Box position={[dx, 1.95, depth / 2]} size={[0.25, 3.9, 0.28]} color={steel} />
          <Bollard x={dx + 0.3} z={depth / 2 + 0.25} />
        </group>
      ))}
      <group position={[officeX, 0, -1]}>
        <Box position={[0, 0.65, 0]} size={[office - 2, 1.25, 1.05]} color="#bb8c52" />
        <Box position={[0, 1.32, 0]} size={[office - 1.8, 0.14, 1.2]} color="#e1bd85" />
        {[-1.1, 1.1].map((dx) => (
          <group key={dx}>
            <Box position={[dx, 1.5, 0]} size={[0.13, 0.3, 0.15]} color={steel} />
            <Box position={[dx, 1.8, 0]} size={[0.7, 0.48, 0.09]} color={steel} />
            <Box position={[dx, 1.42, 0.3]} size={[0.65, 0.035, 0.2]} color="#dadbd0" />
          </group>
        ))}
      </group>
      {owners.map((owner, index) => (
        <group
          key={owner.id}
          position={[officeX + (index - (owners.length - 1) / 2) * 1.2, 0, -2.5]}
        >
          <Mechanic
            index={index}
            color={owner.color}
            name={`${owner.name} · Patron`}
            animate={false}
            resting
            location="office"
          />
        </group>
      ))}
      {[-1.65, 1.65].map((dx) => (
        <group key={dx} position={[officeX + dx, 0, 2.25]}>
          <Box position={[0, 0.38, 0]} size={[1.55, 0.48, 1.05]} color="#3d474c" />
          <Box position={[0, 0.85, 0.45]} size={[1.55, 0.65, 0.2]} color="#48535a" />
          {[-0.7, 0.7].map((side) => (
            <Box key={side} position={[side, 0.66, 0]} size={[0.18, 0.4, 1.05]} color="#48535a" />
          ))}
        </group>
      ))}
      <Box position={[officeX, 0.32, 2.1]} size={[1, 0.12, 1.1]} color="#bb8c52" />
      <Box position={[officeX, 0.16, 2.1]} size={[0.12, 0.3, 0.12]} color={steel} />
      <Plant x={width / 2 - 0.7} z={-depth / 2 + 0.7} scale={0.7} />
      <Plant x={divider + 0.7} z={depth / 2 - 0.6} scale={0.7} />
      <group position={[width / 2 - 0.65, 0, -0.2]}>
        <Box position={[0, 0.55, 0]} size={[0.5, 1.1, 0.5]} color="#d8d8cd" />
        <mesh position={[0, 1.3, 0]}>
          <cylinderGeometry args={[0.22, 0.22, 0.5, 12]} />
          <meshStandardMaterial color="#6da8c8" transparent opacity={0.75} />
        </mesh>
      </group>
      <Box position={[width / 2, 0.22, 0]} size={[0.18, 0.44, depth]} color="#c0b39e" />
      <mesh position={[width / 2, 1.5, -1.5]}>
        <boxGeometry args={[0.06, 2.6, 4.6]} />
        <meshStandardMaterial color="#a3d4de" transparent opacity={0.16} depthWrite={false} />
      </mesh>
      {[-depth / 2, 0.8, depth / 2].map((dz) => (
        <Box key={dz} position={[width / 2, 1.8, dz]} size={[0.13, 3.6, 0.13]} color={steel} />
      ))}
      <Box position={[width / 2, 3.6, 0]} size={[0.22, 0.18, depth]} color={steel} />
      <Html
        portal={portal}
        position={[-width / 2 + stock / 2, 3.15, -depth / 2 + 0.45]}
        center
        transform
        distanceFactor={11}
        zIndexRange={[10, 0]}
      >
        <button
          className="building-sign room-sign stock-sign"
          aria-label="Gérer le stock"
          title="Pièces, réservations et commandes"
          onClick={onOpenStock}
        >
          ▣ STOCK ↗
        </button>
      </Html>
      <Html
        portal={portal}
        position={[officeX, 3.15, -depth / 2 + 0.45]}
        center
        transform
        distanceFactor={11}
        style={{ pointerEvents: 'none' }}
      >
        <div className="building-sign room-sign">ACCUEIL CLIENTS</div>
      </Html>
      <WallLight x={officeX} z={-depth / 2 + 0.25} />
    </group>
  );
}

export function GarageGround({
  site,
  zones,
}: {
  site: ReturnType<typeof garageSite>;
  zones: ZoneLayout[];
}) {
  const { minX, maxX, minZ, maxZ, entryX } = site;
  const width = maxX - minX,
    depth = maxZ - minZ,
    cx = (minX + maxX) / 2,
    cz = (minZ + maxZ) / 2;
  return (
    <group>
      <Box position={[cx, -0.48, cz]} size={[width + 3, 0.8, depth + 3]} color="#68746e" />
      <Box position={[cx, -0.03, cz]} size={[width, 0.08, depth]} color="#7b7f7c" />
      <Box position={[cx, -0.07, maxZ + 1.2]} size={[width + 3, 0.15, 2]} color="#bfb8a7" />
      <Box position={[minX - 0.6, 0, cz]} size={[1, 0.16, depth]} color="#738651" />
      <Box position={[maxX + 0.6, 0, cz]} size={[1, 0.16, depth]} color="#738651" />
      <Box position={[cx, 0.015, 0]} size={[width, 0.035, circulationWidth]} color="#6c7374" />
      {[minX + circulationWidth / 2, maxX - circulationWidth / 2].map((x) => (
        <Box
          key={x}
          position={[x, 0.015, cz]}
          size={[circulationWidth - 0.6, 0.035, depth]}
          color="#6c7374"
        />
      ))}
      {[minZ + circulationWidth / 2, maxZ - circulationWidth / 2].map((z) => (
        <Box
          key={z}
          position={[cx, 0.015, z]}
          size={[width, 0.035, circulationWidth - 0.6]}
          color="#6c7374"
        />
      ))}
      {zones.map((zone) => {
        const x = zone.x + zone.width / 2 + circulationWidth / 2;
        const far = zone.z + (Math.sign(zone.z) * zone.depth) / 2;
        return (
          <group key={zone.id}>
            <Box
              position={[x, 0.015, far / 2]}
              size={[circulationWidth - 0.6, 0.035, Math.abs(far)]}
              color="#6c7374"
            />
            {Array.from({ length: Math.floor(Math.abs(far) / 4) }, (_, i) => (
              <Box
                key={i}
                position={[x, 0.045, Math.sign(far) * (2 + i * 4)]}
                size={[0.09, 0.02, 1.6]}
                color="#e1dac4"
              />
            ))}
          </group>
        );
      })}
      {Array.from({ length: Math.floor(width / 4) }, (_, i) => (
        <Box
          key={i}
          position={[minX + 2 + i * 4, 0.045, 0]}
          size={[1.6, 0.02, 0.09]}
          color="#e1dac4"
        />
      ))}
      <Box
        position={[entryX, 0.025, (maxZ + 3) / 2]}
        size={[5.8, 0.04, maxZ - 3]}
        color="#687073"
      />
      {[0, 1, 2, 3, 4].map((i) => (
        <Box
          key={i}
          position={[entryX - 2 + i, 0.055, maxZ - 1.3]}
          size={[0.5, 0.02, 2]}
          color="#e2dac6"
        />
      ))}
      <group position={[entryX, 0.06, maxZ - 5]}>
        <Box position={[0, 0, 0.3]} size={[0.35, 0.02, 1.8]} color="#e5ddc8" />
        {[-1, 1].map((side) => (
          <Box
            key={side}
            position={[side * 0.33, 0, -0.45]}
            rotation={[0, side * -0.7, 0]}
            size={[0.3, 0.02, 1]}
            color="#e5ddc8"
          />
        ))}
      </group>
      {[-1, 1].map((side) => (
        <group key={side}>
          <Bollard x={entryX + side * 3.2} z={maxZ - 0.4} />
          <Box
            position={[entryX + side * 3.5, 0.85, maxZ - 0.4]}
            size={[0.65, 1.7, 0.65]}
            color={side > 0 ? '#d8a52d' : steel}
          />
          <Box
            position={[entryX + side * 3.5, 1.35, maxZ - 0.05]}
            size={[0.35, 0.25, 0.04]}
            color="#263642"
          />
        </group>
      ))}
      <group position={[entryX + 3.4, 1.7, maxZ - 0.4]} rotation={[0, 0, -0.95]}>
        <Box position={[-2.2, 0, 0]} size={[4.4, 0.12, 0.12]} color="#eee2c5" />
        {[-0.5, -1.5, -2.5, -3.5].map((x) => (
          <Box key={x} position={[x, 0, 0.07]} size={[0.4, 0.13, 0.025]} color="#bb493d" />
        ))}
      </group>
      {[minX + 0.3, maxX - 0.3].map((x) => (
        <group key={x}>
          <Box position={[x, 0.55, cz]} size={[0.25, 1.1, depth]} color="#9c9d8e" />
          {Array.from({ length: Math.max(2, Math.floor(depth / 7)) }, (_, i) => (
            <group key={i} position={[x, 0, minZ + 2 + i * 7]}>
              <Plant x={x === minX + 0.3 ? -0.6 : 0.6} z={0} scale={1.15} />
              <Box position={[0, 2, 0.8]} size={[0.11, 4, 0.11]} color={steel} />
              <Box position={[0, 4, 0.6]} size={[0.5, 0.12, 0.7]} color={steel} />
              <mesh position={[0, 3.93, 0.6]}>
                <boxGeometry args={[0.4, 0.035, 0.5]} />
                <meshStandardMaterial color="#ffebba" emissive="#ffe4a1" emissiveIntensity={1} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}
