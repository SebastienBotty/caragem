'use client';
import { useGarage } from '../provider';
import { Field, Form, Modal, cents, number, value } from '../ui';

export function PartForm({ close }: { close: () => void }) {
  const { act } = useGarage();
  return (
    <Modal title="Ajouter une pièce" close={close}>
      <Form
        onSubmit={async (f) => {
          await act({
            type: 'part',
            reference: value(f, 'reference'),
            name: value(f, 'name'),
            supplier: value(f, 'supplier'),
            stock: number(f, 'stock'),
            min: number(f, 'min'),
            cost: cents(f, 'cost'),
            price: cents(f, 'price'),
          });
          close();
        }}
      >
        <div className="form-grid">
          <Field label="Référence">
            <input name="reference" required maxLength={200} />
          </Field>
          <Field label="Désignation">
            <input name="name" required maxLength={200} />
          </Field>
        </div>
        <Field label="Fournisseur">
          <input name="supplier" required maxLength={200} />
        </Field>
        <div className="form-grid">
          <Field label="Stock initial">
            <input name="stock" type="number" min={0} max={100000} required defaultValue={0} />
          </Field>
          <Field label="Seuil d’alerte">
            <input name="min" type="number" min={0} max={100000} required defaultValue={1} />
          </Field>
          <Field label="Prix d’achat HT (€)">
            <input name="cost" type="number" min={0} max={1000000} step="0.01" required />
          </Field>
          <Field label="Prix de vente HT (€)">
            <input name="price" type="number" min={0} max={1000000} step="0.01" required />
          </Field>
        </div>
      </Form>
    </Modal>
  );
}
