'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useGarage } from '../provider';
import { Field, Form, Modal, localDateInput, number, value } from '../ui';
import { CustomerForm } from './customer-form';
import { customerVehicles } from '@/lib/customer-vehicles';
import { VehicleModelFields } from './vehicle-model-fields';
export function VehicleForm({
  close,
  initialCustomerId = '',
  initialVehicleId = '',
}: {
  close: () => void;
  initialCustomerId?: string;
  initialVehicleId?: string;
}) {
  const { state, act, can } = useGarage();
  const [customer, setCustomer] = useState(false);
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [vehicleId, setVehicleId] = useState(initialVehicleId);
  const vehicles = customerVehicles(state, customerId).filter((v) => v.customerId === customerId);
  const selected = vehicles.find((v) => v.id === vehicleId);
  const enteringVehicle = customerId && (selected || vehicleId === 'new' || !vehicles.length);
  return (
    <>
      <Modal
        title="Accueillir un véhicule"
        subtitle="Un nouveau dossier, une place dans votre garage."
        close={close}
      >
        <Form
          label="Enregistrer l’arrivée"
          onSubmit={async (f) => {
            await act({
              type: 'vehicle',
              customerId: value(f, 'customerId'),
              existingVehicleId: selected?.id,
              model: selected?.model ?? `${value(f, 'brand')} ${value(f, 'model')}`.trim(),
              plate: value(f, 'plate'),
              mileage: number(f, 'mileage'),
              issue: value(f, 'issue'),
              color: value(f, 'color'),
              due: new Date(value(f, 'due')).toISOString(),
              priority: f.get('priority') === 'on',
              estimatedMinutes:
                value(f, 'estimatedMinutes') === '' ? undefined : number(f, 'estimatedMinutes'),
            });
            close();
          }}
        >
          <Field label="Client">
            <select
              name="customerId"
              required
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setVehicleId('');
              }}
            >
              <option value="" disabled>
                Sélectionner un client
              </option>
              {state.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {can('customers.manage') && (
            <button className="text-button" type="button" onClick={() => setCustomer(true)}>
              <Plus size={14} /> Créer un client
            </button>
          )}
          {customerId && vehicles.length > 0 && (
            <Field label="Véhicule du client">
              <select required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="" disabled>
                  Sélectionner un véhicule
                </option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id} disabled={v.inGarage}>
                    {v.plate} · {v.model}
                    {v.inGarage ? ' — Déjà au garage' : ''}
                  </option>
                ))}
                <option value="new">+ Ajouter un nouveau véhicule à ce client</option>
              </select>
            </Field>
          )}
          {customerId && !vehicles.length && (
            <p className="muted">
              Ce client n’a pas encore de véhicule enregistré. Le véhicule ajouté sera lié à sa
              fiche.
            </p>
          )}
          {enteringVehicle && (
            <div className="arrival-vehicle-fields" key={`${customerId}:${selected?.id ?? 'new'}`}>
              <div className="form-grid">
                <Field label="Immatriculation">
                  <input
                    name="plate"
                    required
                    maxLength={25}
                    placeholder="GH-284-LP"
                    className="plate-input"
                    defaultValue={selected?.plate ?? ''}
                    readOnly={Boolean(selected)}
                  />
                </Field>
                <VehicleModelFields model={selected?.model} />
              </div>
              <div className="form-grid">
                <Field label="Kilométrage">
                  <input
                    name="mileage"
                    type="number"
                    required
                    min={0}
                    max={5000000}
                    defaultValue={selected?.mileage ?? 0}
                  />
                </Field>
                <Field label="Couleur">
                  <input type="color" name="color" defaultValue={selected?.color ?? '#7b9ab6'} />
                </Field>
              </div>
              {selected && (
                <p className="muted small-text">
                  Véhicule enregistré. Vérifiez le kilométrage et la couleur pour cette nouvelle
                  visite.
                </p>
              )}
            </div>
          )}
          <Field label="Motif de la visite">
            <input
              name="issue"
              required
              maxLength={200}
              placeholder="Révision, freinage, voyant moteur…"
            />
          </Field>
          <Field label="Restitution souhaitée">
            <input
              name="due"
              type="datetime-local"
              required
              defaultValue={localDateInput(new Date(Date.now() + 86400000))}
            />
          </Field>
          <Field
            label="Temps de travail prévu (minutes)"
            hint="Facultatif : durée estimée du travail initial, distincte de la date de restitution."
          >
            <input name="estimatedMinutes" type="number" min={0} max={100000} />
          </Field>
          <label className="check-field">
            <input name="priority" type="checkbox" /> Intervention prioritaire
          </label>
        </Form>
      </Modal>
      {customer && can('customers.manage') && (
        <CustomerForm
          close={() => setCustomer(false)}
          onCreated={(id) => {
            setCustomerId(id);
            setVehicleId('');
          }}
        />
      )}
    </>
  );
}
