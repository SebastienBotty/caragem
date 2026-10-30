import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret() {
  let bits = 0,
    value = 0,
    result = '';
  for (const byte of randomBytes(20)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(value >>> bits) & 31];
    }
  }
  return result;
}
export function totp(secret: string, at = Date.now()) {
  if (!/^[A-Z2-7]{32}$/.test(secret)) throw new Error('Invalid TOTP seed');
  let bits = 0,
    value = 0;
  const decoded: number[] = [];
  for (const char of secret) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      decoded.push((value >>> bits) & 255);
    }
  }
  const step = Math.floor(at / 30000);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hash = createHmac('sha1', Buffer.from(decoded)).update(counter).digest();
  const offset = hash[hash.length - 1] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export function validTotp(secret: string, code: string, lastStep: number, at = Date.now()) {
  if (!/^\d{6}$/.test(code)) return undefined;
  const step = Math.floor(at / 30000);
  // One adjacent step tolerates phone clock drift; each accepted counter remains single-use.
  return [step, step - 1, step + 1].find(
    (candidate) =>
      candidate >= 0 &&
      candidate > lastStep &&
      timingSafeEqual(Buffer.from(totp(secret, candidate * 30000)), Buffer.from(code)),
  );
}
function encryptionKey(key = process.env.ACCOUNT_ENCRYPTION_KEY) {
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key))
    throw new Error('ACCOUNT_ENCRYPTION_KEY must contain 32 random bytes as hex');
  return Buffer.from(key, 'hex');
}
export function totpEncryptionAvailable() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}
export function sealTotp(secret: string, key?: string) {
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', encryptionKey(key), nonce);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [nonce, cipher.getAuthTag(), encrypted].map((b) => b.toString('base64url')).join('.');
}
export function openTotp(sealed: string, key?: string) {
  const parts = sealed.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted seed');
  const [nonce, tag, data] = parts.map((p) => Buffer.from(p, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(key), nonce);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
