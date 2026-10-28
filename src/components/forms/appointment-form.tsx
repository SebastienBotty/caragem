'use client';
import { useGarage } from '../provider';
import { Field, Form, Modal, localDateInput, value } from '../ui';

export function AppointmentForm({ close }: { close: () => void }) {
  const { state, act } = useGarage();
  return (
    <Modal title="Nouveau rendez-vous" close={close}>
      <Form
        onSubmit={async (f) => {
          await act({
            type: 'appointment',
            customerId: value(f, 'customerId'),
            model: value(f, 'model'),
            plate: value(f, 'plate'),
            reason: value(f, 'reason'),
            at: new Date(value(f, 'at')).toISOString(),
          });
          close();
        }}
      >
        <Field label="Client">
          <select name="customerId" required>
            <option value="">Sélectionner</option>
            {state.customers.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Véhicule">
            <input name="model" required maxLength={200} placeholder="Renault Mégane" />
          </Field>
          <Field label="Immatriculation">
            <input name="plate" required maxLength={25} />
          </Field>
        </div>
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
  );
}
