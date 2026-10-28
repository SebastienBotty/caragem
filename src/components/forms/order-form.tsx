'use client';
import { useGarage } from '../provider';
import { Field, Form, Modal, cents, localDateInput, number, value } from '../ui';

export function OrderForm({ close }: { close: () => void }) {
  const { state, act } = useGarage();
  return (
    <Modal
      title="Enregistrer une commande"
      subtitle="La commande est passée auprès de votre fournisseur habituel."
      close={close}
    >
      <Form
        onSubmit={async (f) => {
          await act({
            type: 'order',
            unitCost: cents(f, 'unitCost'),
            reference: value(f, 'reference'),
            supplier: value(f, 'supplier'),
            partId: value(f, 'partId'),
            vehicleId: value(f, 'vehicleId'),
            quantity: number(f, 'quantity'),
            due: new Date(value(f, 'due')).toISOString(),
          });
          close();
        }}
      >
        <div className="form-grid">
          <Field label="Référence de commande">
            <input name="reference" required maxLength={200} />
          </Field>
          <Field label="Fournisseur">
            <input name="supplier" required maxLength={200} />
          </Field>
        </div>
        <Field label="Pièce">
          <select name="partId" required>
            <option value="">Sélectionner</option>
            {state.parts.map((p) => (
              <option value={p.id} key={p.id}>
                {p.reference} · {p.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Quantité">
            <input name="quantity" type="number" min={1} max={10000} defaultValue={1} required />
          </Field>
          <Field label="Livraison prévue">
            <input
              name="due"
              type="datetime-local"
              required
              defaultValue={localDateInput(new Date(Date.now() + 86400000))}
            />
          </Field>
        </div>
        <Field label="Prix unitaire HT (€)">
          <input name="unitCost" type="number" required min="0" max="1000000" step="0.01" />
        </Field>
        <Field label="Destination">
          <select name="vehicleId">
            <option value="">Réapprovisionnement du stock</option>
            {state.vehicles
              .filter((v) => v.stage !== 'returned')
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate} · {v.model}
                </option>
              ))}
          </select>
        </Field>
      </Form>
    </Modal>
  );
}
