import { z } from 'zod';

export const accountPreferencesSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']).default('light'),
    initialPage: z.enum(['garage', 'tasks', 'planning']),
    defaultGarageId: z.string().min(1).max(100).optional(),
    graphicsQuality: z.enum(['auto', 'low', 'high']),
    reducedMotion: z.boolean(),
    notifications: z
      .object({
        assignments: z.boolean(),
        blockages: z.boolean(),
        invitations: z.boolean(),
        billing: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type AccountPreferences = z.infer<typeof accountPreferencesSchema>;
export const defaultAccountPreferences: AccountPreferences = {
  theme: 'light',
  initialPage: 'garage',
  graphicsQuality: 'auto',
  reducedMotion: false,
  notifications: { assignments: true, blockages: true, invitations: true, billing: true },
};

export function normalizeAccountPreferences(value: unknown): AccountPreferences {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const notifications =
    raw.notifications && typeof raw.notifications === 'object'
      ? (raw.notifications as Record<string, unknown>)
      : {};
  const fallback = <T>(schema: z.ZodType<T>, input: unknown, defaultValue: T): T => {
    const result = schema.safeParse(input);
    return result.success ? result.data : defaultValue;
  };
  return {
    theme: fallback(accountPreferencesSchema.shape.theme, raw.theme, 'light'),
    initialPage: fallback(accountPreferencesSchema.shape.initialPage, raw.initialPage, 'garage'),
    defaultGarageId: fallback(
      accountPreferencesSchema.shape.defaultGarageId,
      raw.defaultGarageId,
      undefined,
    ),
    graphicsQuality: fallback(
      accountPreferencesSchema.shape.graphicsQuality,
      raw.graphicsQuality,
      'auto',
    ),
    reducedMotion: fallback(z.boolean(), raw.reducedMotion, false),
    notifications: Object.fromEntries(
      Object.keys(defaultAccountPreferences.notifications).map((key) => [
        key,
        fallback(z.boolean(), notifications[key], true),
      ]),
    ) as AccountPreferences['notifications'],
  };
}

export type AccountNotification = {
  id: string;
  kind: keyof AccountPreferences['notifications'];
  title: string;
  description: string;
  garageId: string;
  garageName: string;
  page?: 'tasks' | 'garage' | 'settings';
  vehicleId?: string;
};
