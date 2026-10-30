import type { ServerResponse } from 'node:http';
export function securityHeaders(res: ServerResponse) {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  );
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
export const appOrigin = () => process.env.APP_ORIGIN ?? 'http://localhost:3000';
export function validOrigin(origin?: string) {
  return origin === appOrigin() || (!process.env.APP_ORIGIN && origin === 'http://127.0.0.1:3000');
}
export function cookie(token: string) {
  return `caragem_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${appOrigin().startsWith('https:') ? '; Secure' : ''}`;
}
export type Reply = (status: number, data: unknown) => void;
