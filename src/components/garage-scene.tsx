'use client';
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, RoundedBox, ContactShadows, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { z } from 'zod';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Maximize, Minus, Plus, RotateCcw, MousePointer2 } from 'lucide-react';
import {
  garagePlacement,
  garageSite,
  garageCamera,
  slotPosition,
  mechanicAssignments,
  circulationWidth,
  rowAisle,
  vehicleRoute,
  type ZoneLayout,
} from '@/lib/layout';
import { stages, type GarageState, type Vehicle, type User } from '@/lib/domain';
import { Box, Plant, ToolBench, TireStack } from './garage-primitives';
import {
  GarageGround,
  WorkshopShell,
  ServiceWing,
  BayEquipment,
  ParkingEdge,
} from './garage-environment';
import { Mechanic } from './mechanic';
import { BreakRoom } from './break-room';
import { vehicleBrand } from '@/lib/vehicle-brand';
import { VehiclePriority } from './vehicle-priority';

function Lift({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.12, z]}>
      {[-1.38, 1.38].map((side) => (
        <group key={side}>
          <Box position={[side, 1.65, 0]} size={[0.3, 3.3, 0.45]} color="#2165bd" />
          <Box position={[side, 1.3, 0.26]} size={[0.14, 0.3, 0.08]} color="#ecc244" />
          <Box position={[side, 0.08, 0]} size={[0.65, 0.16, 0.85]} color="#385c89" />
          <Box position={[side / 2, 0.18, 0.5]} size={[1.3, 0.12, 0.16]} color="#557ba5" />
          <Box position={[side / 2, 0.18, -0.5]} size={[1.3, 0.12, 0.16]} color="#557ba5" />
        </group>
      ))}
    </group>
  );
}
function RoofLogo({ model }: { model: string }) {
  const texture = useTexture(`/brands/${vehicleBrand(model)}.svg`);
  return (
    <group>
      <RoundedBox args={[1.12, 0.018, 1.12]} radius={0.008} position={[0, 1.54, -0.28]}>
        <meshStandardMaterial color="#f7f8f5" roughness={0.6} />
      </RoundedBox>
      <mesh position={[0, 1.552, -0.28]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.96, 0.96]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
function Cone({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.12, z]}>
      <Box position={[0, 0.04, 0]} size={[0.48, 0.08, 0.48]} color="#353c42" />
      <mesh castShadow position={[0, 0.32, 0]}>
        <coneGeometry args={[0.2, 0.56, 8]} />
        <meshStandardMaterial color="#e27f31" />
      </mesh>
      <mesh position={[0, 0.34, 0]}>
        <cylinderGeometry args={[0.085, 0.12, 0.1, 8]} />
        <meshStandardMaterial color="#fff0d6" />
      </mesh>
    </group>
  );
}
function Car({
  vehicle,
  target,
  selected,
  onSelect,
  animate,
  workers,
  zones,
}: {
  vehicle: Vehicle;
  target: [number, number, number];
  selected: boolean;
  onSelect: () => void;
  animate: boolean;
  workers: User[];
  zones: ZoneLayout[];
}) {
  const ref = useRef<THREE.Group>(null);
  const first = useRef(true);
  const waypoints = useRef<THREE.Vector3[]>([]);
  const [hover, setHover] = useState(false);
  const crew = useRef<THREE.Group>(null);
  const [tx, ty, tz] = target;

  useEffect(() => {
    if (!ref.current) return;
    if (first.current || !animate) {
      ref.current.position.set(tx, ty, tz);
      ref.current.rotation.y = 0;
      first.current = false;
      waypoints.current = [];
      return;
    }
    const current = ref.current.position;
    if (current.x === tx && current.y === ty && current.z === tz) {
      waypoints.current = [];
      ref.current.rotation.y = 0;
      return;
    }
    waypoints.current = vehicleRoute([current.x, ty, current.z], [tx, ty, tz], zones).map(
      (p) => new THREE.Vector3(...p),
    );
  }, [tx, ty, tz, animate, zones]);

  useFrame((_, dt) => {
    if (crew.current) crew.current.visible = waypoints.current.length === 0;
    const group = ref.current;
    const next = waypoints.current[0];
    if (!group || !next) return;
    const distance = group.position.distanceTo(next);
    const step = Math.min(dt, 0.05) * 11;
    if (distance <= step) {
      group.position.copy(next);
      waypoints.current.shift();
      if (!waypoints.current.length) group.rotation.y = 0;
    } else {
      const direction = next.clone().sub(group.position).normalize();
      group.position.addScaledVector(direction, step);
      const yaw = Math.atan2(direction.x, direction.z);
      group.rotation.y = THREE.MathUtils.damp(group.rotation.y, yaw, 10, dt);
    }
  });
  useEffect(
    () => () => {
      document.body.style.cursor = '';
    },
    [],
  );
  return (
    <group
      ref={ref}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = '';
      }}
    >
      {vehicle.priority && vehicle.stage === 'reception' && <VehiclePriority animate={animate} />}
      {(selected || hover) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[1.7, 1.82, 48]} />
          <meshBasicMaterial color="#4369e8" transparent opacity={0.8} />
        </mesh>
      )}
      <group scale={selected || hover ? 1.035 : 1}>
        <RoundedBox
          args={[1.68, 0.62, 3.45]}
          radius={0.19}
          smoothness={3}
          position={[0, 0.63, 0]}
          castShadow
        >
          <meshStandardMaterial color={vehicle.color} metalness={0.15} roughness={0.35} />
        </RoundedBox>
        {workers.length > 0 && (
          <>
            <Box position={[0, 0.96, 1.12]} size={[1.3, 0.04, 0.95]} color="#263039" />
            <Box position={[0, 1.04, 1.1]} size={[0.65, 0.14, 0.5]} color="#7b858a" />
            <group position={[0, 0.99, 0.65]} rotation={[-1.1, 0, 0]}>
              <Box position={[0, 0, 0.52]} size={[1.45, 0.06, 1.08]} color={vehicle.color} />
            </group>
          </>
        )}
        <RoundedBox
          args={[1.42, 0.64, 1.8]}
          radius={0.17}
          smoothness={3}
          position={[0, 1.14, -0.24]}
          castShadow
        >
          <meshStandardMaterial color="#34495b" metalness={0.35} roughness={0.24} />
        </RoundedBox>
        <RoundedBox
          args={[1.4, 0.12, 1.35]}
          radius={0.04}
          smoothness={2}
          position={[0, 1.47, -0.28]}
          castShadow
        >
          <meshStandardMaterial color={vehicle.color} roughness={0.45} />
        </RoundedBox>
        <Suspense fallback={null}>
          <RoofLogo model={vehicle.model} />
        </Suspense>
        <Box position={[0, 0.99, 0.4]} size={[1.43, 0.08, 0.12]} color={vehicle.color} />
        <Box position={[0, 1.17, -0.26]} size={[1.46, 0.5, 0.09]} color={vehicle.color} />
        {[-0.83, 0.83].flatMap((x) =>
          [-1.02, 1.05].map((z) => (
            <group key={`${x}-${z}`} position={[x, 0.4, z]} rotation={[0, 0, Math.PI / 2]}>
              <mesh castShadow>
                <cylinderGeometry args={[0.35, 0.35, 0.22, 12]} />
                <meshStandardMaterial color="#28313c" />
              </mesh>
              <mesh position={[0, x > 0 ? -0.12 : 0.12, 0]}>
                <cylinderGeometry args={[0.18, 0.18, 0.015, 8]} />
                <meshStandardMaterial color="#bac2cb" metalness={0.7} roughness={0.3} />
              </mesh>
            </group>
          )),
        )}
        {[-0.55, 0.55].map((x) => (
          <group key={x}>
            <Box position={[x, 0.7, 1.73]} size={[0.36, 0.16, 0.035]} color="#ffefc1" />
            <Box position={[x, 0.7, -1.73]} size={[0.36, 0.14, 0.035]} color="#b66062" />
            <Box position={[x * 1.55, 1.02, 0.25]} size={[0.22, 0.12, 0.2]} color={vehicle.color} />
          </group>
        ))}
        <Box position={[0, 0.44, 1.73]} size={[0.75, 0.12, 0.04]} color="#d9dde1" />
      </group>
      <group ref={crew}>
        {workers.map((worker, index) => (
          <Mechanic
            key={worker.id}
            index={index}
            color={worker.color}
            name={worker.name}
            animate={animate}
          />
        ))}
      </group>
    </group>
  );
}
function Zone({
  zone,
  state,
  onFocus,
}: {
  zone: ZoneLayout;
  state: GarageState;
  onFocus: (id: string) => void;
}) {
  const st = stages.find((s) => s.id === zone.id)!;
  const workshop = zone.id === 'workshop';
  const diagnostic = zone.id === 'diagnosis';
  const indoor = zone.z < 0;
  const marking = workshop ? '#3981da' : zone.id === 'ready' ? '#8abc4b' : '#e6b23e';
  const positions = Array.from({ length: zone.slots }, (_, i) => slotPosition(zone, i));
  return (
    <group>
      {indoor && <WorkshopShell zone={zone} />}
      {!indoor && <ParkingEdge zone={zone} />}
      {!indoor && (
        <RoundedBox
          args={[zone.width, 0.08, zone.depth]}
          radius={0.03}
          smoothness={2}
          position={[zone.x, -0.01, zone.z]}
          receiveShadow
        >
          <meshStandardMaterial
            color={zone.id === 'ready' ? '#7b8d63' : '#85857b'}
            roughness={0.88}
          />
        </RoundedBox>
      )}
      {Array.from({ length: zone.rows - 1 }, (_, i) => {
        const z = rowAisle(zone, i + 1);
        return (
          <group key={i}>
            <Box
              position={[zone.x, 0.06, z]}
              size={[zone.width, 0.025, circulationWidth - 0.4]}
              color="#6c7374"
            />
            {Array.from({ length: Math.floor(zone.width / 4) }, (_, j) => (
              <Box
                key={j}
                position={[zone.x - zone.width / 2 + 2 + j * 4, 0.08, z]}
                size={[1.6, 0.015, 0.09]}
                color="#e1dac4"
              />
            ))}
          </group>
        );
      })}
      <Box
        position={[zone.x, 0.045, zone.z - zone.depth / 2 + 0.5]}
        size={[zone.width - 1, 0.025, 0.12]}
        color={marking}
      />
      <Box
        position={[zone.x, 0.045, zone.z + zone.depth / 2 - 0.5]}
        size={[zone.width - 1, 0.025, 0.12]}
        color={marking}
      />
      {[-1, 1].map((side) => (
        <Box
          key={side}
          position={[zone.x + side * (zone.width / 2 - 0.5), 0.045, zone.z]}
          size={[0.12, 0.025, zone.depth - 1]}
          color={marking}
        />
      ))}
      {positions.map(([x, , z], i) => (
        <group key={i}>
          {workshop && (
            <>
              <Box position={[x, 0.065, z]} size={[3.25, 0.04, 4.65]} color="#747c81" />
              <Lift x={x} z={z} />
            </>
          )}
          {[-1.4, 1.4].map((side) => (
            <Box
              key={side}
              position={[x + side, 0.095, z]}
              size={[0.14, 0.02, 4.7]}
              color={marking}
            />
          ))}
          <Box position={[x, 0.095, z - 2.35]} size={[2.85, 0.02, 0.14]} color={marking} />
          {(workshop || diagnostic) && (
            <>
              <BayEquipment x={x} z={z - 2.8} diagnostic={diagnostic} />
              <ToolBench x={x + 1.25} z={z + 2} width={0.55} />
            </>
          )}
          {zone.id === 'waiting' && <TireStack x={x - 1.1} z={z - 2.7} />}
          {!indoor && (
            <Box position={[x, 0.14, z + 1.95]} size={[1.6, 0.18, 0.25]} color="#d8cfac" />
          )}
          {diagnostic && <Cone x={x - 1.15} z={z + 2.1} />}
        </group>
      ))}
      <Html
        position={[zone.x, 3.05, zone.z - zone.depth / 2 + 0.65]}
        center
        transform
        distanceFactor={13}
        zIndexRange={[10, 0]}
      >
        <button
          className="zone-label workshop-sign"
          style={{
            background: workshop
              ? '#2768b5'
              : zone.id === 'ready'
                ? '#568d35'
                : zone.id === 'waiting'
                  ? '#d29630'
                  : '#586372',
          }}
          onClick={() => onFocus(zone.id)}
        >
          <i />
          {workshop
            ? 'En cours'
            : zone.id === 'waiting'
              ? 'En attente'
              : zone.id === 'ready'
                ? 'Terminé'
                : st.label}
          <b>{state.vehicles.filter((v) => v.stage === zone.id).length}</b>
        </button>
      </Html>
      {[-1.8, 1.8].map((side) => (
        <Box
          key={side}
          position={[zone.x + side, 1.5, zone.z - zone.depth / 2 + 0.65]}
          size={[0.12, 3, 0.12]}
          color="#676d72"
        />
      ))}
      <Plant x={zone.x - zone.width / 2 + 0.7} z={zone.z - zone.depth / 2 + 0.85} scale={0.7} />
    </group>
  );
}
const cameraViewSchema = z.object({
  position: z.tuple([z.number(), z.number(), z.number()]),
  target: z.tuple([z.number(), z.number(), z.number()]),
  zoom: z.number().positive().max(1000),
});

function Camera({
  garageId,
  focus,
  zones,
  zoom,
  reset,
}: {
  garageId?: string;
  focus: string;
  zones: ZoneLayout[];
  zoom: number;
  reset: number;
}) {
  const ref = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  const target = useRef(new THREE.Vector3());
  const position = useRef(new THREE.Vector3(40, 45, 45));
  const moving = useRef(true);
  const previousRequest = useRef<{ garageId?: string; focus: string; reset: number }>(undefined);
  const previousZoom = useRef(zoom);
  const view = useRef<z.infer<typeof cameraViewSchema>>(undefined);
  const persist = useCallback(() => {
    if (!garageId || !view.current) return;
    try {
      sessionStorage.setItem(`carm-camera:${garageId}`, JSON.stringify(view.current));
    } catch {
      /* The current camera still works when browser storage is unavailable. */
    }
  }, [garageId]);
  useEffect(() => {
    window.addEventListener('pagehide', persist);
    return () => {
      persist();
      window.removeEventListener('pagehide', persist);
    };
  }, [persist]);
  useEffect(() => {
    const previous = previousRequest.current;
    const initial = !previous || previous.garageId !== garageId;
    if (!initial && previous.focus === focus && previous.reset === reset) return;
    previousRequest.current = { garageId, focus, reset };
    if (initial && garageId && ref.current) {
      try {
        const raw = sessionStorage.getItem(`carm-camera:${garageId}`);
        const saved = cameraViewSchema.safeParse(raw ? JSON.parse(raw) : undefined);
        if (saved.success) {
          view.current = saved.data;
          camera.position.fromArray(saved.data.position);
          camera.zoom = saved.data.zoom;
          camera.updateProjectionMatrix();
          ref.current.target.fromArray(saved.data.target);
          moving.current = false;
          ref.current.update();
          return;
        }
      } catch {
        /* An unreadable saved view falls back to the overview. */
      }
    }
    const frame = garageCamera(zones, focus, size.width / size.height);
    target.current.set(...frame.target);
    position.current.set(...frame.position);
    moving.current = true;
  }, [garageId, focus, reset, zones, size.width, size.height, camera]);
  useEffect(() => {
    if (previousZoom.current === zoom) return;
    previousZoom.current = zoom;
    moving.current = false;
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom *= zoom > 0 ? 1.22 : 0.82;
      camera.updateProjectionMatrix();
    } else if (ref.current) {
      const dir = camera.position.clone().sub(ref.current.target);
      camera.position.copy(
        ref.current.target.clone().add(dir.multiplyScalar(zoom > 0 ? 0.82 : 1.22)),
      );
    }
    ref.current?.update();
    persist();
  }, [zoom, camera, persist]);
  useFrame((_, dt) => {
    if (!moving.current || !ref.current) return;
    const t = 1 - Math.exp(-5 * dt);
    camera.position.lerp(position.current, t);
    ref.current.target.lerp(target.current, t);
    ref.current.update();
    if (camera.position.distanceTo(position.current) < 0.03) {
      moving.current = false;
      persist();
    }
  });
  return (
    <OrbitControls
      ref={ref}
      makeDefault
      enableRotate={false}
      mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }}
      minDistance={9}
      maxDistance={1500}
      enableDamping
      onChange={() => {
        if (ref.current)
          view.current = {
            position: camera.position.toArray(),
            target: ref.current.target.toArray(),
            zoom: camera.zoom,
          };
      }}
      onEnd={persist}
      onStart={() => {
        moving.current = false;
      }}
    />
  );
}
class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export default function GarageScene({
  state,
  selected,
  onSelect,
  filter,
  focus,
  setFocus,
  onOpenStock,
  preview = false,
}: {
  state: GarageState;
  selected: string | null;
  onSelect: (id: string) => void;
  filter: (v: Vehicle) => boolean;
  focus: string;
  setFocus: (id: string) => void;
  onOpenStock: () => void;
  preview?: boolean;
}) {
  const previousPlacement = useRef<ReturnType<typeof garagePlacement> | undefined>(undefined);
  const placement = useMemo(() => garagePlacement(state, previousPlacement.current), [state]);
  useLayoutEffect(() => {
    previousPlacement.current = placement;
  }, [placement]);
  const { zones, positions } = placement;
  const [zoom, setZoom] = useState(0);
  const [reset, setReset] = useState(0);
  const [animate, setAnimate] = useState(false);
  const initialCamera = useMemo(
    () => ({
      position: [40, 45, 45] as [number, number, number],
      fov: 39,
      zoom: preview ? 1 : 3,
      near: 0.1,
      far: 2000,
    }),
    [preview],
  );
  useEffect(() => {
    const q = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setAnimate(!q.matches);
    update();
    q.addEventListener('change', update);
    return () => q.removeEventListener('change', update);
  }, []);
  const site = garageSite(zones);
  const assignments = mechanicAssignments(state);
  const fallback = (
    <div className="scene-fallback">
      <h3>La vue 3D n’est pas disponible sur cet appareil.</h3>
      <p>Vos véhicules restent accessibles ci-dessous.</p>
      <div>
        {state.vehicles
          .filter((v) => v.stage !== 'returned' && filter(v))
          .map((v) => (
            <button key={v.id} onClick={() => onSelect(v.id)}>
              {v.plate} · {v.model}
            </button>
          ))}
      </div>
    </div>
  );
  return (
    <div className="garage-canvas">
      <div className="scene-top">
        <span className="scene-mode">
          <span className="live-dot" />
          {preview ? 'APERÇU DU GARAGE' : 'VUE DU GARAGE'}
        </span>
        <span className="scene-hint">
          {preview
            ? 'Ajoutez des modules pour voir votre garage évoluer'
            : 'Cliquez sur un véhicule pour ouvrir son dossier'}
        </span>
      </div>
      <SceneBoundary fallback={fallback}>
        <Canvas
          shadows
          dpr={[1, 1.6]}
          camera={initialCamera}
          fallback={fallback}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
        >
          <color attach="background" args={['#d9dfd9']} />
          <fog attach="fog" args={['#d9dfd9', 200, 700]} />
          <ambientLight intensity={0.6} />
          <hemisphereLight args={['#fff7e8', '#85909d', 1.1]} />
          <directionalLight
            color="#fff0d1"
            position={[-25, 45, 20]}
            intensity={2.7}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-55}
            shadow-camera-right={55}
            shadow-camera-top={50}
            shadow-camera-bottom={-50}
            shadow-bias={-0.0004}
          />
          <GarageGround site={site} zones={zones} />
          <ServiceWing
            site={site}
            onOpenStock={onOpenStock}
            owners={state.users.filter((u) => u.role === 'owner')}
          />
          <BreakRoom
            room={site.lounge}
            mechanics={assignments.filter((a) => a.vehicleId === null).map((a) => a.user)}
            animate={animate && !preview}
            onFocus={() => setFocus('lounge')}
          />
          {zones.map((zone) => (
            <Zone key={zone.id} zone={zone} state={state} onFocus={setFocus} />
          ))}
          {state.vehicles
            .filter((v) => positions.has(v.id) && filter(v))
            .map((v) => (
              <Car
                key={v.id}
                vehicle={v}
                target={positions.get(v.id)!}
                selected={v.id === selected}
                onSelect={() => onSelect(v.id)}
                animate={
                  animate &&
                  !preview &&
                  previousPlacement.current?.modulesKey === placement.modulesKey
                }
                workers={assignments.filter((a) => a.vehicleId === v.id).map((a) => a.user)}
                zones={zones}
              />
            ))}
          <ContactShadows
            position={[0, -0.9, (site.maxZ + site.minZ) / 2]}
            opacity={0.23}
            scale={130}
            blur={2.5}
            far={15}
            resolution={512}
            frames={1}
          />
          <Camera
            garageId={preview ? undefined : state.id}
            focus={focus}
            zones={zones}
            zoom={zoom}
            reset={reset}
          />
        </Canvas>
      </SceneBoundary>
      <div className="scene-bottom">
        <span>
          <MousePointer2 size={13} /> Glisser pour déplacer · Molette pour zoomer
        </span>
        <div className="scene-controls">
          <button
            title="Zoomer"
            aria-label="Zoomer"
            onClick={() => setZoom((z) => Math.abs(z) + 1)}
          >
            <Plus size={18} />
          </button>
          <button
            title="Dézoomer"
            aria-label="Dézoomer"
            onClick={() => setZoom((z) => -Math.abs(z) - 1)}
          >
            <Minus size={18} />
          </button>
          <span />
          <button
            title="Vue d’ensemble"
            aria-label="Vue d’ensemble"
            onClick={() => {
              setFocus('all');
              setReset((n) => n + 1);
            }}
          >
            <Maximize size={17} />
          </button>
          <button
            title="Réinitialiser la caméra"
            aria-label="Réinitialiser la caméra"
            onClick={() => {
              setFocus('all');
              setReset((n) => n + 1);
            }}
          >
            <RotateCcw size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
