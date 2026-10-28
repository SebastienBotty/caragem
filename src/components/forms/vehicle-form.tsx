'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useGarage } from '../provider';
import { Field, Form, Modal, localDateInput, number, value } from '../ui';
import { CustomerForm } from './customer-form';
export function VehicleForm({ close }: { close: () => void }) {
  const { state, act } = useGarage();
  const [customer, setCustomer] = useState(false);
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
              model: value(f, 'model'),
              plate: value(f, 'plate'),
              mileage: number(f, 'mileage'),
              issue: value(f, 'issue'),
              color: value(f, 'color'),
              due: new Date(value(f, 'due')).toISOString(),
              priority: f.get('priority') === 'on',
            });
            close();
          }}
        >
          <Field label="Client">
            <select name="customerId" required defaultValue="">
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
          <button className="text-button" type="button" onClick={() => setCustomer(true)}>
            <Plus size={14} /> Créer un client
          </button>
          <div className="form-grid">
            <Field label="Immatriculation">
              <input
                name="plate"
                required
                maxLength={25}
                placeholder="GH-284-LP"
                className="plate-input"
              />
            </Field>
            <Field label="Marque et modèle">
              <input name="model" required maxLength={100} placeholder="Peugeot 308" />
            </Field>
          </div>
          <div className="form-grid">
            <Field label="Kilométrage">
              <input name="mileage" type="number" required min={0} max={5000000} defaultValue={0} />
            </Field>
            <Field label="Couleur">
              <input type="color" name="color" defaultValue="#7b9ab6" />
            </Field>
          </div>
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
          <label className="check-field">
            <input name="priority" type="checkbox" /> Intervention prioritaire
          </label>
        </Form>
      </Modal>
      {customer && <CustomerForm close={() => setCustomer(false)} />}
    </>
  );
}
