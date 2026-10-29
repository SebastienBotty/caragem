import { z } from 'zod';
export const photoCategories = [
  { id: 'arrival', label: 'État à l’arrivée' },
  { id: 'diagnosis', label: 'Diagnostic / défaut' },
  { id: 'repair', label: 'Intervention' },
  { id: 'delivery', label: 'Contrôle / restitution' },
] as const;
export const photoUploadSchema = z.object({
  vehicleId: z.string().min(1).max(100),
  category: z.enum(photoCategories.map((category) => category.id)),
  caption: z.string().trim().min(1).max(500),
  finding: z.enum(['information', 'ok', 'attention', 'urgent']).default('information'),
  image: z.string().max(12 * 1024 * 1024),
});
export type VehiclePhoto = {
  id: string;
  category: (typeof photoCategories)[number]['id'];
  caption: string;
  finding: 'information' | 'ok' | 'attention' | 'urgent';
  createdAt: string;
  author: string;
  bytes: number;
  taskId?: string;
};
