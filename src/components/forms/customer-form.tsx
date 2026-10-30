'use client';
import { useGarage } from '../provider';
import { Field, Form, Modal, value } from '../ui';

export function CustomerForm({
  close,
  onCreated,
}: {
  close: () => void;
  onCreated?: (id: string) => void;
}) {
  const { act } = useGarage();
  return (
    <Modal title="Nouveau client" subtitle="Le début d’une relation qui roule." close={close}>
      <Form
        onSubmit={async (f) => {
          const state = await act({
            type: 'customer',
            name: value(f, 'name'),
            email: value(f, 'email'),
            phone: value(f, 'phone'),
          });
          onCreated?.(state.customers.at(-1)!.id);
          close();
        }}
      >
        <CustomerFields />
      </Form>
    </Modal>
  );
}

export function CustomerFields({
  values,
}: {
  values?: { name: string; email: string; phone: string };
}) {
  return (
    <>
      <Field label="Nom ou raison sociale">
        <input
          name="name"
          required
          maxLength={200}
          placeholder="Sophie Dubois"
          value={values?.name}
          readOnly={!!values}
        />
      </Field>
      <div className="form-grid">
        <Field label="Adresse mail">
          <input
            name="email"
            type="email"
            required
            placeholder="sophie@example.fr"
            value={values?.email}
            readOnly={!!values}
          />
        </Field>
        <Field label="Téléphone">
          <input
            name="phone"
            type="tel"
            maxLength={40}
            placeholder="06 12 34 56 78"
            value={values?.phone}
            readOnly={!!values}
          />
        </Field>
      </div>
    </>
  );
}
