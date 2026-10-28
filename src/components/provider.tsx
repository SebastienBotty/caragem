'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Action, GarageState, User } from '@/lib/domain';

export async function request<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'La requête a échoué.');
  return data;
}
type Context = {
  state: GarageState;
  user: User;
  connected: boolean;
  smtp: boolean;
  act: (a: Action) => Promise<void>;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
  api: (path: string, body: unknown) => Promise<void>;
};
const Ctx = createContext<Context | null>(null);
export function useGarage() {
  const c = useContext(Ctx);
  if (!c) throw new Error('Garage non chargé');
  return c;
}
export function GarageProvider({
  children,
  initial,
  onSessionChange,
}: {
  children: ReactNode;
  initial: { state: GarageState; userId: string; smtp: boolean };
  onSessionChange: () => Promise<void>;
}) {
  const [state, setState] = useState(initial.state);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState('');
  const socket = useRef<Socket | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accept = useCallback(
    (next: GarageState) => setState((old) => (next.revision >= old.revision ? next : old)),
    [],
  );
  const notify = useCallback((s: string) => {
    setToast(s);
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setToast(''), 4500);
  }, []);
  useEffect(() => {
    const s = io({ withCredentials: true });
    socket.current = s;
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('garage:state', accept);
    s.on('connect_error', () => setConnected(false));
    return () => {
      s.disconnect();
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [accept]);
  const act = async (a: Action) => {
    const result = await request<{ state: GarageState }>('actions', a);
    accept(result.state);
  };
  const api = async (path: string, body: unknown) => {
    const result = await request<{ state?: GarageState }>(path, body);
    if (result.state) accept(result.state);
  };
  const user = state.users.find((u) => u.id === initial.userId)!;
  return (
    <Ctx.Provider
      value={{
        state,
        user,
        connected,
        smtp: initial.smtp,
        act,
        notify,
        api,
        refresh: onSessionChange,
      }}
    >
      {children}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </Ctx.Provider>
  );
}
