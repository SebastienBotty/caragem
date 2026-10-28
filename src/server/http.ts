export const appOrigin = () => process.env.APP_ORIGIN ?? 'http://localhost:3000';
export function validOrigin(origin?: string) {
  return origin === appOrigin() || (!process.env.APP_ORIGIN && origin === 'http://127.0.0.1:3000');
}
export function cookie(token: string) {
  return `carm_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${appOrigin().startsWith('https:') ? '; Secure' : ''}`;
}
export type Reply = (status: number, data: unknown) => void;
