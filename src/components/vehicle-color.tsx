'use client';
import { useEffect, useState } from 'react';
import type { Vehicle } from '@/lib/domain';
import { useGarage } from './provider';
import { Button } from './ui';

const paints = [
  ['Noir', '#20242b'],
  ['Blanc', '#eff0ec'],
  ['Gris', '#8b939d'],
  ['Argent', '#c5cbd0'],
  ['Rouge', '#bb292d'],
  ['Bleu', '#245da8'],
  ['Vert', '#326b51'],
  ['Jaune', '#e5ba35'],
  ['Orange', '#cb6b2b'],
  ['Beige', '#c3ac84'],
] as const;

export function VehicleColor({ vehicle }: { vehicle: Vehicle }) {
  const { act, can } = useGarage();
  const [color, setColor] = useState(vehicle.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setColor(vehicle.color);
    setError('');
  }, [vehicle.id, vehicle.color]);
  if (vehicle.stage === 'returned' || !can('vehicles.edit')) return null;
  return (
    <section className="vehicle-paint" aria-label="Couleur du véhicule">
      <div>
        <strong>Couleur du véhicule</strong>
        <span>{paints.find((p) => p[1] === color)?.[0] ?? 'Personnalisée'}</span>
      </div>
      <div className="paint-swatches">
        {paints.map(([name, hex]) => (
          <button
            key={hex}
            aria-label={name}
            title={name}
            aria-pressed={color === hex}
            style={{ background: hex }}
            onClick={() => setColor(hex)}
          />
        ))}
        <label title="Couleur personnalisée">
          <input
            aria-label="Couleur personnalisée"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
      </div>
      {color !== vehicle.color && (
        <Button
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await act({ type: 'vehicleColor', id: vehicle.id, color });
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Appliquer la couleur
        </Button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
