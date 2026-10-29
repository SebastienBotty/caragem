'use client';
import { useState } from 'react';
import { vehicleMakes } from '@/lib/vehicle-makes';
import { Field } from '../ui';

export function VehicleModelFields({ model }: { model?: string }) {
  const [brand, setBrand] = useState('');
  if (model !== undefined)
    return (
      <Field label="Marque et modèle">
        <input name="model" required maxLength={200} defaultValue={model} readOnly />
      </Field>
    );
  return (
    <>
      <Field label="Marque">
        <select
          name={brand === 'other' ? undefined : 'brand'}
          required
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
        >
          <option value="" disabled>
            Sélectionner une marque
          </option>
          {vehicleMakes.map((make) => (
            <option key={make} value={make}>
              {make}
            </option>
          ))}
          <option value="other">Autre marque</option>
        </select>
      </Field>
      {brand === 'other' && (
        <Field label="Précisez la marque">
          <input name="brand" required maxLength={49} />
        </Field>
      )}
      <Field label="Modèle">
        <input name="model" required maxLength={150} placeholder="308, Golf, Classe A…" />
      </Field>
    </>
  );
}
