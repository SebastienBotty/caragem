'use client';
import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { request, useGarage } from './provider';
import { Badge, Button, Field, Form, Modal, value } from './ui';

export function GarageSwitcher({ close }: { close: () => void }) {
  const { state, garages, refresh } = useGarage();
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title="Mes garages"
      subtitle="Un compte personnel, un rôle propre à chaque garage."
      close={close}
    >
      <div className="garage-access-list">
        {garages.map((garage) => (
          <button
            key={garage.id}
            disabled={busy || garage.id === state.id}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await request('switch-garage', { garageId: garage.id });
                await refresh();
                close();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <span>
              <strong>{garage.name}</strong>
              <small>
                {garage.role === 'owner'
                  ? 'Responsable'
                  : garage.role === 'mechanic'
                    ? 'Mécanicien'
                    : 'Accueil'}
              </small>
            </span>
            {garage.id === state.id ? <Check size={18} /> : <Badge>Ouvrir</Badge>}
          </button>
        ))}
      </div>
      {!create ? (
        <Button onClick={() => setCreate(true)}>
          <Plus size={16} />
          Créer un autre garage
        </Button>
      ) : (
        <Form
          label="Créer mon garage"
          onSubmit={async (f) => {
            await request('garages', { name: value(f, 'name') });
            await refresh();
            close();
          }}
        >
          <Field label="Nom du nouveau garage">
            <input
              name="name"
              required
              minLength={2}
              maxLength={100}
              autoFocus
              placeholder="Garage du Centre"
            />
          </Field>
          <p className="muted">
            Vous serez responsable de ce garage. Aucun paiement n’est demandé à cette étape.
          </p>
        </Form>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
