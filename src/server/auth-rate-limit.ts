const attempts = new Map<string, { count: number; until: number }>();
export function authAttemptAllowed(address = 'unknown', limit = 40) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  const rate = attempts.get(address) ?? { count: 0, until: now + 15 * 60000 };
  rate.count++;
  attempts.set(address, rate);
  return rate.count <= limit;
}
