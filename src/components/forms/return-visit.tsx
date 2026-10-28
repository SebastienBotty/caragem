'use client';
import { type Vehicle } from '@/lib/domain';
import { useGarage } from '../provider';
import { Field, Form, Modal, localDateInput, value } from '../ui';

export function ReturnVisit({ vehicle, close }: { vehicle: Vehicle; close: () => void }) {
  const { act } = useGarage();
  return (
    <Modal title={`Nouvelle visite · ${vehicle.plate}`} close={close}>
      <Form
        onSubmit={async (f) => {
          await act({
            type: 'revisit',
            id: vehicle.id,
            issue: value(f, 'issue'),
            due: new Date(value(f, 'due')).toISOString(),
          });
          close();
        }}
      >
        <Field label="Motif">
          <input name="issue" required maxLength={200} />
        </Field>
        <Field label="Restitution souhaitée">
          <input
            name="due"
            type="datetime-local"
            required
            defaultValue={localDateInput(new Date(Date.now() + 86400000))}
          />
        </Field>
        <p className="muted">Le dossier précédent est conservé dans l’historique.</p>
      </Form>
    </Modal>
  );
}
