import type { ServerResponse } from 'node:http';
import type { Server } from 'socket.io';
import sharp from 'sharp';
import { z } from 'zod';
import { UserError } from '../lib/errors.ts';
import { photoUploadSchema } from '../lib/vehicle-photos.ts';
import { uid, log, type GarageState } from '../lib/domain.ts';
import { requirePermission, visibleState } from '../lib/permissions.ts';
import { broadcastGarage } from './realtime.ts';
import type { Store, Session } from './store.ts';

export async function normalizedPhoto(dataUrl: string) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new UserError('Choisissez une image JPEG, PNG ou WebP.');
  const input = Buffer.from(match[2], 'base64');
  if (!input.length || input.length > 8 * 1024 * 1024 || input.toString('base64') !== match[2])
    throw new UserError('La photo doit faire au maximum 8 Mio.');
  try {
    // ASVS 5.2.1/5.2.2/5.2.6: decode with a pixel limit and re-encode without original metadata.
    const image = sharp(input, { limitInputPixels: 40_000_000, animated: false });
    const metadata = await image.metadata();
    if (metadata.format !== match[1] || (metadata.pages ?? 1) > 1)
      throw new Error('Invalid image format');
    const output = await image
      .rotate()
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    if (output.length > 1024 * 1024) throw new Error('Image too large');
    return output;
  } catch {
    throw new UserError(
      'Image invalide, trop grande ou non prise en charge (40 mégapixels maximum).',
    );
  }
}

function photoAccess(
  state: GarageState,
  session: Session,
  vehicleId: string,
  edit: boolean,
  closedDeletion = false,
) {
  const actor = state.users.find((user) => user.id === session.userId);
  const vehicle = state.vehicles.find((vehicle) => vehicle.id === vehicleId);
  if (!actor || !vehicle) throw new UserError('Dossier introuvable.');
  requirePermission(
    state,
    actor,
    'garage.view',
    ...(edit ? ['vehicles.edit' as const] : []),
    ...(vehicle.stage === 'returned' ? ['history.view' as const] : []),
  );
  if (edit && vehicle.stage === 'returned' && (!closedDeletion || actor.role !== 'owner'))
    throw new UserError('Cette visite est clôturée.');
  return { actor, vehicle };
}

export async function vehiclePhotoApi(
  store: Store,
  io: Server,
  method: string | undefined,
  path: string,
  body: unknown,
  session: Session,
  res: ServerResponse,
) {
  if (!path.startsWith('/api/vehicle-photos')) return false;
  const send = (data: unknown) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  };
  if (method === 'GET' && path.startsWith('/api/vehicle-photos/')) {
    const id = path.slice('/api/vehicle-photos/'.length);
    const state = await store.get(session.garageId);
    const vehicle = state.vehicles.find((vehicle) =>
      vehicle.photos?.some((photo) => photo.id === id),
    );
    if (!vehicle) throw new UserError('Photo introuvable.');
    photoAccess(state, session, vehicle.id, false);
    // ASVS 8.2.2/5.3.2: both the record and image must belong to the authenticated garage.
    const result = await store.db.query(
      'SELECT image FROM vehicle_photos WHERE garage_id=$1 AND id=$2',
      [session.garageId, id],
    );
    const image = result.rows[0]?.image as Buffer | undefined;
    if (!image) throw new UserError('Photo introuvable.');
    send({ image: `data:image/jpeg;base64,${image.toString('base64')}` });
    return true;
  }
  if (method === 'POST' && path === '/api/vehicle-photos') {
    const input = photoUploadSchema.parse(body);
    photoAccess(await store.get(session.garageId), session, input.vehicleId, true);
    const image = await normalizedPhoto(input.image);
    const { state } = await store.updateGarage(session.garageId, async (state, sql) => {
      const { actor, vehicle } = photoAccess(state, session, input.vehicleId, true);
      // ASVS 5.2.4: quotas are checked under the garage row lock, including concurrent uploads.
      if ((vehicle.photos?.length ?? 0) >= 30) throw new UserError('Maximum 30 photos par visite.');
      const quota = await sql.query(
        'SELECT COALESCE(SUM(octet_length(image)),0) AS bytes FROM vehicle_photos WHERE garage_id=$1',
        [state.id],
      );
      if (Number(quota.rows[0].bytes) + image.length > 250 * 1024 * 1024)
        throw new UserError(
          'Stockage photo du garage plein (250 Mio). Supprimez des photos ou contactez votre hébergeur.',
        );
      const photo = {
        id: uid(),
        category: input.category,
        caption: input.caption,
        finding: input.finding,
        createdAt: new Date().toISOString(),
        author: actor.name,
        bytes: image.length,
      };
      await sql.query('INSERT INTO vehicle_photos(id,garage_id,image) VALUES($1,$2,$3)', [
        photo.id,
        state.id,
        image,
      ]);
      (vehicle.photos ??= []).push(photo);
      state.revision++;
      log(state, `Photo ajoutée sur ${vehicle.plate} : ${photo.caption}`, actor.name, [
        'garage.view',
      ]);
    });
    await broadcastGarage(io, state);
    send({ state: visibleState(state, session.userId) });
    return true;
  }
  if (method === 'POST' && path === '/api/vehicle-photos/delete') {
    const { id } = z.object({ id: z.string().min(1).max(100) }).parse(body);
    const { state } = await store.updateGarage(session.garageId, async (state, sql) => {
      const found = state.vehicles.find((vehicle) =>
        vehicle.photos?.some((photo) => photo.id === id),
      );
      if (!found) throw new UserError('Photo introuvable.');
      const { actor, vehicle } = photoAccess(state, session, found.id, true, true);
      await sql.query('DELETE FROM vehicle_photos WHERE garage_id=$1 AND id=$2', [state.id, id]);
      vehicle.photos = vehicle.photos!.filter((photo) => photo.id !== id);
      state.revision++;
      log(state, `Photo supprimée sur ${vehicle.plate}`, actor.name, ['garage.view']);
    });
    await broadcastGarage(io, state);
    send({ state: visibleState(state, session.userId) });
    return true;
  }
  throw new UserError('Opération photo invalide.');
}
