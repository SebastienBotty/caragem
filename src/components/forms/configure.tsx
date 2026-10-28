'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Plus,
  Minus,
  CarFront,
  Microscope,
  ParkingCircle,
  Wrench,
  CircleCheck,
} from 'lucide-react';
import { stages } from '@/lib/domain';
import { useGarage } from '../provider';
import { Field, Form, Modal, value } from '../ui';

const GarageScene = dynamic(() => import('../garage-scene'), {
  ssr: false,
  loading: () => <div className="scene-loading">Votre atelier prend forme…</div>,
});

export function Configure({ close }: { close: () => void }) {
  const { state, act } = useGarage();
  const [modules, setModules] = useState(state.settings.modules);
  const [focus, setFocus] = useState('all');
  const preview = useMemo(
    () => ({ ...state, settings: { ...state.settings, modules } }),
    [state, modules],
  );
  const icons = [CarFront, Microscope, ParkingCircle, Wrench, CircleCheck];
  return (
    <Modal
      className="configure-modal"
      title={state.settings.configured ? 'Organiser mon garage' : 'Bienvenue dans votre garage'}
      subtitle="Choisissez vos modules. L’espace s’organise automatiquement et reste extensible."
      close={close}
    >
      <div className="configure-layout">
        <Form
          className="configure-options"
          label="Enregistrer mon garage"
          onSubmit={async (f) => {
            await act({
              type: 'settings',
              name: value(f, 'name'),
              country: value(f, 'country') as 'FR' | 'BE',
              address: value(f, 'address'),
              businessId: value(f, 'businessId'),
              modules: {
                reception: modules.reception,
                diagnosis: modules.diagnosis,
                waiting: modules.waiting,
                workshop: modules.workshop,
                ready: modules.ready,
              },
            });
            close();
          }}
        >
          <div className="form-grid">
            <Field label="Nom du garage">
              <input name="name" required maxLength={200} defaultValue={state.settings.name} />
            </Field>
            <Field label="Pays">
              <select name="country" defaultValue={state.settings.country}>
                <option value="FR">France</option>
                <option value="BE">Belgique</option>
              </select>
            </Field>
          </div>
          <Field label="Adresse">
            <input name="address" maxLength={2000} defaultValue={state.settings.address} />
          </Field>
          <Field label="Identifiant d’entreprise / TVA">
            <input name="businessId" maxLength={2000} defaultValue={state.settings.businessId} />
          </Field>
          <div className="module-config">
            {stages.map((s, i) => {
              const Icon = icons[i];
              return (
                <div className="module-config-row" key={s.id}>
                  <span
                    className="module-icon"
                    style={{ color: s.color, background: s.color + '15' }}
                  >
                    <Icon size={21} />
                  </span>
                  <div>
                    <strong>{s.label}</strong>
                    <small>
                      {s.id === 'workshop' || s.id === 'diagnosis'
                        ? '1 poste par module'
                        : '4 places par module'}
                    </small>
                  </div>
                  <div className="stepper">
                    <button
                      type="button"
                      aria-label={`Réduire ${s.label}`}
                      disabled={modules[s.id] <= 1}
                      onClick={() => setModules((m) => ({ ...m, [s.id]: m[s.id] - 1 }))}
                    >
                      <Minus size={15} />
                    </button>
                    <b>{modules[s.id]}</b>
                    <button
                      type="button"
                      aria-label={`Augmenter ${s.label}`}
                      disabled={modules[s.id] >= 10}
                      onClick={() => setModules((m) => ({ ...m, [s.id]: m[s.id] + 1 }))}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="muted small-text">
            La capacité est indicative : des places supplémentaires apparaissent si nécessaire.
          </p>
        </Form>
        <section className="configure-preview" aria-label="Aperçu de votre garage">
          <GarageScene
            state={preview}
            selected={null}
            onSelect={() => {}}
            filter={() => true}
            focus={focus}
            setFocus={setFocus}
            onOpenStock={() => {}}
            preview
          />
          <p className="configure-preview-note" aria-live="polite">
            {stages.map((s) => `${s.label} : ${modules[s.id]}`).join(' · ')}
          </p>
          <p className="muted small-text">
            Vos modifications seront appliquées à l’enregistrement.
          </p>
        </section>
      </div>
    </Modal>
  );
}
