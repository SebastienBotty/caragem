import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import type { ReactElement } from 'react';
import * as layout from '../src/lib/layout.ts';
import * as domain from '../src/lib/domain.ts';

test('priority marker floats and pulses slowly, stays static with reduced motion and does not intercept clicks', () => {
  const require = createRequire(import.meta.url);
  type Element = ReactElement<Record<string, any>>;
  let frame: (state: { clock: { elapsedTime: number } }) => void;
  const mocks: Record<string, unknown> = {
    react: { useRef: () => ({ current: null }) },
    '@react-three/fiber': {
      useFrame: (callback: typeof frame) => (frame = callback),
      useThree: () => ({ gl: { domElement: { parentElement: {} } } }),
    },
    '@react-three/drei': { Html: 'Html' },
  };
  const exports: { VehiclePriority?: (props: { animate: boolean }) => Element } = {};
  const code = ts.transpileModule(
    readFileSync(new URL('../src/components/vehicle-priority.tsx', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => mocks[name] ?? require(name) });
  function render(animate: boolean) {
    const elements: Element[] = [];
    function visit(node: any) {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node?.props) return;
      elements.push(node);
      visit(node.props.children);
    }
    visit(exports.VehiclePriority!({ animate }));
    const marker = elements.find((e) => e.type === 'group' && e.props.ref)!;
    const ring = elements.find((e) => e.type === 'mesh')!;
    const material = elements.find((e) => e.type === 'meshBasicMaterial')!;
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(),
      new THREE.MeshBasicMaterial(material.props),
    );
    marker.props.ref.current = group;
    ring.props.ref.current = mesh;
    assert.equal(
      elements.find((e) => (e.type as unknown) === 'Html')!.props.style.pointerEvents,
      'none',
    );
    assert.equal(
      elements.find((e) => e.type === 'span')!.props['aria-label'],
      'Véhicule prioritaire',
    );
    const label = elements.find((e) => e.type === 'span')!;
    assert.equal(label.props.style.background, undefined);
    assert.equal(label.props.style.border, undefined);
    return { group, mesh };
  }
  const animated = render(true);
  frame!({ clock: { elapsedTime: 0.45 } });
  const color = animated.mesh.material.color.clone();
  const height = animated.group.position.y;
  frame!({ clock: { elapsedTime: 1.35 } });
  assert.notEqual(animated.mesh.material.color.getHex(), color.getHex());
  assert.notEqual(animated.group.position.y, height);
  const still = render(false);
  frame!({ clock: { elapsedTime: 0.45 } });
  const initial = {
    color: still.mesh.material.color.getHex(),
    y: still.group.position.y,
    scale: still.mesh.scale.x,
    opacity: still.mesh.material.opacity,
  };
  frame!({ clock: { elapsedTime: 99 } });
  assert.deepEqual(
    {
      color: still.mesh.material.color.getHex(),
      y: still.group.position.y,
      scale: still.mesh.scale.x,
      opacity: still.mesh.material.opacity,
    },
    initial,
  );
  assert.ok(initial.opacity > 0);
});

test('only priority vehicles at reception show the alert, alongside the selection ring', () => {
  const require = createRequire(import.meta.url);
  const react = require('react');
  const mocks: Record<string, unknown> = {
    react: {
      ...react,
      useRef: (value: unknown) => ({ current: value }),
      useMemo: (fn: () => unknown) => fn(),
      useState: (value: unknown) => [value, () => {}],
      useEffect() {},
      useLayoutEffect() {},
    },
    '@/lib/layout': layout,
    '@/lib/domain': domain,
    three: THREE,
    '@react-three/fiber': { useFrame() {} },
    './vehicle-priority': { VehiclePriority: 'VehiclePriority' },
  };
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(
    readFileSync(new URL('../src/components/garage-scene.tsx', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (name: string) =>
      mocks[name] ??
      (name === 'react/jsx-runtime'
        ? require(name)
        : new Proxy({}, { get: (_, key) => String(key) })),
  });
  function nodes(tree: any) {
    const result: any[] = [];
    function visit(node: any) {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node?.props) return;
      result.push(node);
      visit(node.props.children);
    }
    visit(tree);
    return result;
  }
  const state = domain.createSeed('priority-scene', true);
  const scene = (filter: () => boolean) =>
    exports.default({
      state,
      selected: null,
      onSelect() {},
      filter,
      focus: 'all',
      setFocus() {},
      onOpenStock() {},
    });
  const car = nodes(scene(() => true)).find((node) => node.props.vehicle)!;
  for (const stage of [...domain.stages.map((s) => s.id), 'returned']) {
    const tree = nodes(
      car.type({
        ...car.props,
        vehicle: { ...car.props.vehicle, priority: true, stage },
        selected: true,
      }),
    );
    assert.equal(
      tree.some((node) => node.type === 'VehiclePriority'),
      stage === 'reception',
      stage,
    );
    assert.ok(
      tree.some((node) => node.type === 'meshBasicMaterial' && node.props.color === '#4369e8'),
    );
  }
  const ordinary = nodes(
    car.type({
      ...car.props,
      vehicle: { ...car.props.vehicle, priority: false, stage: 'reception' },
    }),
  );
  assert.equal(
    ordinary.some((node) => node.type === 'VehiclePriority'),
    false,
  );
  assert.equal(
    nodes(scene(() => false)).some((node) => node.props.vehicle),
    false,
  );
});
