'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useGarage } from '../provider';
import { Field, Form, Modal, localDateInput, value } from '../ui';
import { CustomerForm } from './customer-form';
import { customerVehicles } from '@/lib/customer-vehicles';
import { VehicleModelFields } from './vehicle-model-fields';

export function AppointmentForm({ close }: { close: () => void }) {
  const { state, act, can } = useGarage();
  const [customer, setCustomer] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const vehicles = customerVehicles(state, customerId).filter((v) => v.customerId === customerId);
  const selected = vehicles.find((v) => v.id === vehicleId);
  const enteringVehicle = customerId && (selected || vehicleId === 'new' || !vehicles.length);
  return (
    <>
      <Modal title="Nouveau rendez-vous" close={close}>
        <Form
          onSubmit={async (f) => {
            await act({
              type: 'appointment',
              customerId: value(f, 'customerId'),
              model: selected?.model ?? `${value(f, 'brand')} ${value(f, 'model')}`.trim(),
              plate: value(f, 'plate'),
              reason: value(f, 'reason'),
              at: new Date(value(f, 'at')).toISOString(),
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
              <option value="">Sélectionner</option>
              {state.customers.map((c) => (
                <option value={c.id} key={c.id}>
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
                  <option key={v.id} value={v.id}>
                    {v.plate} · {v.model}
                  </option>
                ))}
                <option value="new">+ Ajouter un nouveau véhicule à ce client</option>
              </select>
            </Field>
          )}
          {customerId && !vehicles.length && (
            <p className="muted">
              Ce client n’a pas encore de véhicule enregistré. Renseignez celui du rendez-vous.
            </p>
          )}
          {enteringVehicle && (
            <div className="form-grid" key={`${customerId}:${selected?.id ?? 'new'}`}>
              <VehicleModelFields model={selected?.model} />
              <Field label="Immatriculation">
                <input
                  name="plate"
                  required
                  maxLength={25}
                  defaultValue={selected?.plate ?? ''}
                  readOnly={Boolean(selected)}
                />
              </Field>
            </div>
          )}
          <Field label="Motif">
            <input name="reason" required maxLength={200} />
          </Field>
          <Field label="Date et heure">
            <input
              name="at"
              type="datetime-local"
              required
              defaultValue={localDateInput(new Date(Date.now() + 86400000))}
            />
          </Field>
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
