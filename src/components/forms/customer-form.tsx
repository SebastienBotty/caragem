'use client';
import { useGarage } from '../provider';
import { Field, Form, Modal, value } from '../ui';

export function CustomerForm({ close }: { close: () => void }) {
  const { act } = useGarage();
  return (
    <Modal title="Nouveau client" subtitle="Le début d’une relation qui roule." close={close}>
      <Form
        onSubmit={async (f) => {
          await act({
            type: 'customer',
            name: value(f, 'name'),
            email: value(f, 'email'),
            phone: value(f, 'phone'),
          });
          close();
        }}
      >
        <Field label="Nom ou raison sociale">
          <input name="name" required maxLength={200} placeholder="Sophie Dubois" />
        </Field>
        <div className="form-grid">
          <Field label="Adresse mail">
            <input name="email" type="email" required placeholder="sophie@example.fr" />
          </Field>
          <Field label="Téléphone">
            <input name="phone" type="tel" maxLength={40} placeholder="06 12 34 56 78" />
          </Field>
        </div>
      </Form>
    </Modal>
  );
}
