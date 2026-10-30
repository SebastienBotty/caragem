'use client';
import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { request, useGarage } from './provider';
import { Badge, Button, Field, Form, Modal, value } from './ui';

export function GarageSwitcher({ close }: { close: () => void }) {
  const { state, garages, refresh, account } = useGarage();
  const demoExpired = account?.demoExpires !== undefined && account.demoExpires <= Date.now();
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
      <Button
        disabled={busy || state.demo || demoExpired}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await request('demo', {});
            await refresh();
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {state.demo
          ? 'Démonstration en cours'
          : demoExpired
            ? 'Essai de démonstration terminé'
            : 'Ouvrir ma démonstration (24 h)'}
      </Button>
      {state.demo && state.demoExpires && (
        <p className="muted">Expiration : {new Date(state.demoExpires).toLocaleString('fr-FR')}.</p>
      )}
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
            Vous serez responsable de ce garage. Les 14 jours d’essai sont offerts uniquement pour
            votre premier garage. Chaque garage supplémentaire nécessite son propre abonnement de 25
            € TTC/mois et reste en lecture seule jusqu’à sa souscription.
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
