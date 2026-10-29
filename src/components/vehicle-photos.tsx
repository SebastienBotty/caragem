'use client';
import { useEffect, useState } from 'react';
import { photoCategories, type VehiclePhoto } from '@/lib/vehicle-photos';
import type { Vehicle } from '@/lib/domain';
import { useGarage } from './provider';
import { Badge, Button, Field, Form, Modal, formatDate, value } from './ui';

const findingLabels = {
  information: 'Observation',
  ok: 'Conforme',
  attention: 'À surveiller',
  urgent: 'À traiter',
};
function Photo({ photo, vehicle }: { photo: VehiclePhoto; vehicle: Vehicle }) {
  const { request, api, act, can, user } = useGarage();
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setError('');
    request<{ image: string }>(`vehicle-photos/${photo.id}`)
      .then((result) => {
        if (active) setImage(result.image);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [photo.id, request, retry]);
  return (
    <article className="vehicle-photo">
      {image && (
        <button
          className="photo-preview"
          onClick={() => setExpanded(true)}
          aria-label={`Agrandir : ${photo.caption}`}
        >
          <img src={image} alt={photo.caption} />
        </button>
      )}
      {!image && !error && <p className="muted">Chargement de la photo…</p>}
      {error && (
        <>
          <p className="form-error" role="alert">
            {error}
          </p>
          <Button onClick={() => setRetry(retry + 1)}>Réessayer</Button>
        </>
      )}
      <Badge
        tone={
          photo.finding === 'ok'
            ? 'green'
            : photo.finding === 'urgent'
              ? 'red'
              : photo.finding === 'attention'
                ? 'amber'
                : ''
        }
      >
        {findingLabels[photo.finding]}
      </Badge>
      <p>{photo.caption}</p>
      <small>
        {photo.author} · {formatDate(photo.createdAt)}
      </small>
      {vehicle.stage !== 'returned' && vehicle.stage !== 'ready' && can('tasks.manage') && (
        <Button
          disabled={busy || !!photo.taskId}
          onClick={async () => {
            setBusy(true);
            try {
              await act({
                type: 'addTask',
                vehicleId: vehicle.id,
                photoId: photo.id,
                title: photo.caption.slice(0, 200),
              });
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {photo.taskId ? 'Travail créé' : 'Créer un travail'}
        </Button>
      )}
      {can('vehicles.edit') && (vehicle.stage !== 'returned' || user.role === 'owner') && (
        <Button
          disabled={busy}
          onClick={async () => {
            if (!confirm('Supprimer définitivement cette photo ?')) return;
            setBusy(true);
            try {
              await api('vehicle-photos/delete', { id: photo.id });
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Supprimer la photo
        </Button>
      )}
      {expanded && (
        <Modal title={photo.caption} close={() => setExpanded(false)} wide>
          <img className="photo-expanded" src={image} alt={photo.caption} />
        </Modal>
      )}
    </article>
  );
}

export function VehiclePhotos({ vehicle }: { vehicle: Vehicle }) {
  const { can, api } = useGarage();
  const photos = vehicle.photos ?? [];
  return (
    <>
      <h3>Dossier photo ({photos.length}/30)</h3>
      {vehicle.stage !== 'returned' && can('vehicles.edit') && photos.length < 30 && (
        <Form
          key={photos.length}
          label="Ajouter la photo"
          onSubmit={async (f) => {
            const file = f.get('image');
            if (!(file instanceof File) || !file.size) throw new Error('Choisissez une photo.');
            if (file.size > 8 * 1024 * 1024)
              throw new Error('La photo doit faire au maximum 8 Mio.');
            const image = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error('Lecture de la photo impossible.'));
              reader.readAsDataURL(file);
            });
            await api('vehicle-photos', {
              vehicleId: vehicle.id,
              category: value(f, 'category'),
              finding: value(f, 'finding'),
              caption: value(f, 'caption'),
              image,
            });
          }}
        >
          <Field label="Photo (JPEG, PNG ou WebP, 8 Mio maximum)">
            <input
              name="image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              required
            />
          </Field>
          <Field label="Étape">
            <select name="category">
              {photoCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Constat">
            <select name="finding">
              {Object.entries(findingLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Légende / observation">
            <textarea
              name="caption"
              required
              maxLength={500}
              placeholder="Rayure à l’arrivée, pièce usée, contrôle après réparation…"
            />
          </Field>
        </Form>
      )}
      {!photos.length && <p className="muted">Aucune photo pour cette visite.</p>}
      {photoCategories.map((category) => {
        const group = photos.filter((photo) => photo.category === category.id);
        return group.length ? (
          <section key={category.id}>
            <h3 className="subsection-heading">{category.label}</h3>
            <div className="vehicle-photo-grid">
              {group.map((photo) => (
                <Photo key={photo.id} photo={photo} vehicle={vehicle} />
              ))}
            </div>
          </section>
        ) : null;
      })}
    </>
  );
}
