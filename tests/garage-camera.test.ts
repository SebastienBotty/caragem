import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import * as layout from '../src/lib/layout.ts';
import * as domain from '../src/lib/domain.ts';
import * as scene from '../src/lib/scene-preferences.ts';

test('camera preserves wheel and button zoom through actions, resize and remount; only explicit framing resets it', () => {
  const require = createRequire(import.meta.url);
  const storage = new Map<string, string>();
  const listeners = new Map<string, () => void>();
  let active: any;
  let context: any;
  let accountContext: any = null;
  const equal = (a: unknown[], b?: unknown[]) =>
    b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    ...require('react'),
    useContext: () => accountContext,
    useRef(value: unknown) {
      const index = active.index++;
      return (active.slots[index] ??= { current: value });
    },
    useMemo(fn: () => unknown, deps: unknown[]) {
      const index = active.index++;
      if (!equal(deps, active.slots[index]?.deps)) active.slots[index] = { deps, value: fn() };
      return active.slots[index].value;
    },
    useCallback(fn: unknown, deps: unknown[]) {
      return react.useMemo(() => fn, deps);
    },
    useState(value: unknown) {
      return [react.useRef(value).current, () => {}];
    },
    useEffect(effect: () => unknown, deps: unknown[]) {
      const index = active.index++;
      const slots = active.slots;
      if (equal(deps, slots[index]?.deps)) return;
      active.effects.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { deps, cleanup: effect() };
      });
    },
    useLayoutEffect(effect: () => unknown, deps: unknown[]) {
      react.useEffect(effect, deps);
    },
  };
  const mocks: Record<string, unknown> = {
    react,
    three: THREE,
    zod: require('zod'),
    '@/lib/layout': layout,
    '@/lib/domain': domain,
    '@/lib/scene-preferences': scene,
    '@react-three/fiber': {
      useThree: () => context,
      useFrame: (fn: unknown) => (active.frame = fn),
    },
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL('../src/components/garage-scene.tsx', import.meta.url), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports,
      require: (name: string) =>
        mocks[name] ??
        (name === 'react/jsx-runtime'
          ? require(name)
          : new Proxy({}, { get: (_, key) => String(key) })),
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
      window: {
        addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
        removeEventListener: (name: string) => listeners.delete(name),
      },
    },
  );
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
  const state = domain.createSeed('camera-a', true);
  active = { index: 0, slots: [], effects: [] };
  const sceneProps = {
    state,
    selected: null,
    onSelect() {},
    filter: () => true,
    focus: 'all',
    setFocus() {},
    onOpenStock() {},
  };
  const tree = exports.default(sceneProps);
  const sceneHooks = active;
  const cameraProps = nodes(tree).find((node) => node.props.reset !== undefined);
  const canvas = nodes(tree).find((node) => node.props.camera);
  active = { ...sceneHooks, index: 0, effects: [] };
  const nextTree = exports.default({
    ...sceneProps,
    state: { ...state, revision: state.revision + 1 },
  });
  assert.equal(nodes(nextTree).find((node) => node.props.camera).props.camera, canvas.props.camera);
  function mount(garageId?: string) {
    const hooks: any = { index: 0, slots: [], effects: [] };
    const camera = new THREE.PerspectiveCamera(39, 2, 0.1, 2000);
    camera.position.set(40, 45, 45);
    camera.zoom = 3;
    const size = { width: 1200, height: 600 };
    let element: any;
    const controls = {
      target: new THREE.Vector3(),
      update() {
        element.props.onChange();
      },
    };
    let props = { ...cameraProps.props, animate: true, garageId };
    const render = (changes = {}) => {
      props = { ...props, ...changes };
      active = hooks;
      hooks.index = 0;
      hooks.effects = [];
      context = { camera, size };
      element = cameraProps.type(props);
      element.props.ref.current = controls;
      hooks.effects.forEach((effect: () => void) => effect());
    };
    render();
    return {
      camera,
      controls,
      size,
      render,
      frame() {
        hooks.frame({}, 0.1);
      },
      damping() {
        return element.props.enableDamping;
      },
      settle() {
        for (let i = 0; i < 120; i++) hooks.frame({}, 0.1);
      },
      move() {
        element.props.onStart();
        camera.position.set(16, 30, 40);
        controls.target.set(3, 1, 5);
        controls.update();
        element.props.onEnd();
      },
      dispose() {
        hooks.slots.forEach((slot: any) => slot?.cleanup?.());
      },
    };
  }
  const view = mount('camera-a');
  view.settle();
  view.move();
  const position = view.camera.position.clone();
  const target = view.controls.target.clone();
  view.render({ zones: [...cameraProps.props.zones] });
  view.size.width = 600;
  view.render();
  view.settle();
  assert.ok(view.camera.position.equals(position));
  assert.ok(view.controls.target.equals(target));
  let distance = view.camera.position.distanceTo(target);
  for (const [zoom, factor] of [
    [1, 0.82],
    [2, 0.82],
    [-3, 1.22],
  ]) {
    view.render({ zoom });
    view.settle();
    distance *= factor;
    assert.ok(Math.abs(view.camera.position.distanceTo(target) - distance) < 1e-8);
  }
  listeners.get('pagehide')!();
  const saved = JSON.parse(storage.get('caragem-camera:camera-a')!);
  view.dispose();
  const restored = mount('camera-a');
  restored.settle();
  assert.deepEqual(restored.camera.position.toArray(), saved.position);
  assert.deepEqual(restored.controls.target.toArray(), saved.target);
  restored.render({ reset: 1 });
  restored.settle();
  assert.ok(restored.camera.position.distanceTo(new THREE.Vector3(...saved.position)) > 1);
  restored.render({ focus: 'workshop' });
  restored.settle();
  const expected = layout.garageCamera(cameraProps.props.zones, 'workshop', 2);
  assert.ok(restored.camera.position.distanceTo(new THREE.Vector3(...expected.position)) < 0.04);
  restored.render({ animate: false, focus: 'diagnosis' });
  restored.frame();
  const immediate = layout.garageCamera(cameraProps.props.zones, 'diagnosis', 2);
  assert.ok(restored.camera.position.distanceTo(new THREE.Vector3(...immediate.position)) < 1e-8);
  assert.equal(restored.damping(), false);
  restored.dispose();
  const other = mount('camera-b');
  other.settle();
  assert.notDeepEqual(other.camera.position.toArray(), saved.position);
  other.dispose();
  const count = storage.size;
  const preview = mount();
  preview.move();
  preview.dispose();
  assert.equal(storage.size, count);
  storage.set('caragem-camera:invalid', '{broken');
  const invalid = mount('invalid');
  invalid.settle();
  assert.ok(invalid.camera.position.toArray().every(Number.isFinite));
  invalid.dispose();
  accountContext = { account: { preferences: { graphicsQuality: 'low', reducedMotion: true } } };
  active = { index: 0, slots: [], effects: [] };
  const lowTree = nodes(exports.default(sceneProps));
  const lowCanvas = lowTree.find((node) => node.props.camera);
  assert.equal(lowCanvas.props.dpr, 1);
  assert.equal(lowCanvas.props.shadows, false);
  assert.equal(lowCanvas.props.gl.antialias, false);
  assert.equal(
    lowTree.some((node) => node.type === 'ContactShadows'),
    false,
  );
  assert.equal(lowTree.find((node) => node.props.reset !== undefined).props.animate, false);
});
