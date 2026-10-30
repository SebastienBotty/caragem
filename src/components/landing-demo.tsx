'use client';

import { useEffect, useRef, useState } from 'react';
import GarageScene from './garage-scene';
import { GarageContext, type request as realRequest } from './provider';
import { CustomerFields, CustomerForm } from './forms/customer-form';
import { VehicleForm } from './forms/vehicle-form';
import { VehicleDrawer } from './vehicle-drawer';
import { InventoryScreen } from './screens/inventory-screen';
import { TeamScreen } from './screens/team-screen';
import { Badge, Button, Field } from './ui';
import { applyAction, type Action } from '@/lib/domain';
import { createLandingDemo, landingChapters } from '@/lib/landing-demo';
import { can as hasPermission } from '@/lib/permissions';

export default function LandingDemo() {
  const [demo] = useState(createLandingDemo);
  const [step, setStep] = useState(0);
  const [fill, setFill] = useState(0);
  const [free, setFree] = useState(false);
  const [local, setLocal] = useState(demo.snapshots[6]);
  const [focus, setFocus] = useState('all');
  const [screen, setScreen] = useState('garage');
  const [dialog, setDialog] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const chapters = useRef<(HTMLElement | null)[]>([]);
  const state = free ? local : demo.snapshots[step];
  const current = useRef(state);
  current.current = state;
  const actor = state.users[0];
  useEffect(() => {
    if (free) return;
    let frame = 0;
    function update() {
      const anchor = innerHeight * 0.72;
      let nearest = 0;
      let distance = Infinity;
      chapters.current.forEach((element, i) => {
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const d = Math.abs(rect.top + rect.height / 2 - anchor);
        if (d < distance) {
          distance = d;
          nearest = i;
        }
      });
      setStep(nearest);
      const rect = chapters.current[0]?.getBoundingClientRect();
      if (rect)
        setFill(Math.max(0, Math.min(1, (innerHeight * 0.95 - rect.top) / (rect.height * 0.65))));
    }
    const scroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    addEventListener('scroll', scroll, { passive: true });
    addEventListener('resize', scroll);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', scroll);
      removeEventListener('resize', scroll);
    };
  }, [free]);
  useEffect(() => {
    if (!free) setFocus(step >= 6 ? 'ready' : step >= 3 ? 'workshop' : 'all');
  }, [step, free]);
  const act = async (action: Action) => {
    if (!free) throw new Error('Passez en mode libre pour essayer cette action.');
    const next = applyAction(current.current, action, actor);
    current.current = next;
    setLocal(next);
    return next;
  };
  // This provider has no real transport: demo actions never reach a user garage.
  const request: typeof realRequest = async <T,>(path: string): Promise<T> => {
    if (path === 'invitations') return { invitations: [] } as T;
    throw new Error('Cette action en ligne est indisponible dans la démonstration.');
  };
  const openVehicle = (id: string) => {
    setSelected(id);
    setDialog('vehicle');
  };
  const panel = free
    ? screen
    : step === 2
      ? 'team'
      : step === 4 || step === 5
        ? 'stock'
        : step === 0
          ? 'customer'
          : 'summary';
  const vehicle = state.vehicles.find((v) => v.id === demo.vehicleId);
  const typed = (text: string, start: number, end: number) =>
    text.slice(
      0,
      Math.floor(text.length * Math.max(0, Math.min(1, (fill - start) / (end - start)))),
    );
  const go = (i: number) =>
    requestAnimationFrame(() => {
      chapters.current[i]?.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
        block: 'center',
      });
    });
  return (
    <GarageContext.Provider
      value={{
        state,
        user: actor,
        training: true,
        connected: true,
        smtp: false,
        account: null,
        garages: [],
        onboardingSeen: true,
        can: (permission) => free && hasPermission(state, actor, permission),
        act,
        request,
        api: async () => {
          throw new Error('Action en ligne indisponible dans la démonstration.');
        },
        notify: setNotice,
        refresh: async () => {},
      }}
    >
      <section className="landing-story" id="histoire" aria-label="Une intervention dans CaRM">
        <div className="landing-stage">
          <div className="landing-stage-bar">
            <span>
              <i /> Atelier des Peupliers <small> / Démonstration</small>
            </span>
            <span>{free ? 'À vous de jouer' : landingChapters[step][0]}</span>
          </div>
          <div className="landing-stage-body">
            <div className={`landing-scene ${free ? '' : 'landing-scene-scripted'}`} inert={!free}>
              <GarageScene
                state={state}
                selected={vehicle?.id ?? null}
                onSelect={openVehicle}
                filter={() => true}
                focus={focus}
                setFocus={setFocus}
                onOpenStock={() => {
                  setFree(true);
                  setScreen('stock');
                }}
              />
            </div>
            <aside className="landing-panel" aria-label="Gestion du garage">
              {panel === 'customer' && (
                <>
                  <p className="landing-eyebrow">01 / LE PREMIER CONTACT</p>
                  <h2>Nouveau client</h2>
                  <p className="muted">Le début d’une relation qui roule.</p>
                  <div className="form landing-autofill">
                    <CustomerFields
                      values={{
                        name: typed('Camille Martin', 0, 0.3),
                        email: typed('camille@example.com', 0.3, 0.7),
                        phone: typed('04 70 12 34 56', 0.7, 1),
                      }}
                    />
                  </div>
                  <Badge tone={fill >= 0.99 ? 'green' : 'blue'}>
                    {fill >= 0.99
                      ? '✓ Coordonnées renseignées'
                      : 'Les champs se remplissent au défilement'}
                  </Badge>
                </>
              )}
              {panel === 'team' && (
                <>
                  <div className="landing-panel-label">
                    Sarah est affectée à la révision de Camille.
                  </div>
                  <div inert={!free}>
                    <TeamScreen />
                  </div>
                </>
              )}
              {panel === 'stock' && (
                <>
                  <div className="landing-stock-change" aria-live="polite">
                    <span>
                      {free
                        ? 'Stock de démonstration'
                        : step === 4
                          ? 'Filtre utilisé sur la Peugeot 308'
                          : 'Réception de cinq filtres'}
                    </span>
                    <strong>
                      {free ? state.parts[0].stock : step === 4 ? '4 → 3' : '3 → 8'}{' '}
                      <small>en stock</small>
                    </strong>
                  </div>
                  <div inert={!free}>
                    <InventoryScreen />
                  </div>
                </>
              )}
              {panel === 'summary' && vehicle && (
                <>
                  <p className="landing-eyebrow">LE DOSSIER DE CAMILLE</p>
                  <h2>{vehicle.model}</h2>
                  <Badge tone="blue">{vehicle.plate}</Badge>
                  <div className="landing-vehicle-fields">
                    <Field label="Client">
                      <input readOnly value="Camille Martin" />
                    </Field>
                    <Field label="Demande">
                      <input readOnly value={vehicle.issue} />
                    </Field>
                    <Field label="Kilométrage">
                      <input readOnly value="60 000 km" />
                    </Field>
                  </div>
                  <div className="landing-task">
                    <span>
                      {step >= 6
                        ? '✓ Révision terminée'
                        : step >= 3
                          ? '● Intervention en cours'
                          : step >= 2
                            ? 'Affectée à Sarah'
                            : '✓ Arrivée enregistrée'}
                    </span>
                    <small>
                      {step >= 6
                        ? '75 min enregistrées · Véhicule prêt'
                        : 'Révision annuelle et filtre à huile'}
                    </small>
                  </div>
                  <Button onClick={() => openVehicle(vehicle.id)}>Ouvrir le dossier ↗</Button>
                </>
              )}
              {panel === 'garage' && (
                <>
                  <p className="landing-eyebrow">VOTRE ESPACE D’ESSAI</p>
                  <h2>À vous de jouer.</h2>
                  <p>Déplacez la vue, sélectionnez un véhicule et essayez les outils de gestion.</p>
                  <div className="landing-demo-actions">
                    <Button onClick={() => setDialog('customer')}>Nouveau client</Button>
                    <Button onClick={() => setDialog('arrival')}>Accueillir un véhicule</Button>
                    <Button onClick={() => setScreen('team')}>Gérer l’équipe</Button>
                    <Button onClick={() => setScreen('stock')}>Gérer le stock</Button>
                  </div>
                </>
              )}
            </aside>
          </div>
          <div className="landing-step-nav" aria-label="Étapes de démonstration">
            {landingChapters.map((chapter, i) => (
              <button
                key={chapter[0]}
                aria-label={chapter[0]}
                aria-current={!free && step === i ? 'step' : undefined}
                onClick={() => {
                  if (free) {
                    setFree(false);
                    setDialog('');
                  }
                  go(i);
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </button>
            ))}
            <Button
              onClick={() => {
                setFree(!free);
                setScreen('garage');
                setDialog('');
              }}
            >
              {free ? 'Reprendre le parcours' : 'Essayer librement ↗'}
            </Button>
            {free && <Button onClick={() => setScreen('garage')}>Vue garage</Button>}
          </div>
        </div>
        <div className={`landing-chapters ${free ? 'landing-paused' : ''}`}>
          {landingChapters.map(([time, title, text], i) => (
            <article
              key={time}
              ref={(el) => {
                chapters.current[i] = el;
              }}
              className={step === i ? 'is-active' : ''}
            >
              <p className="landing-eyebrow">{time}</p>
              <h2>{title}</h2>
              <p>{text}</p>
              <span>
                {i === 0
                  ? '↓ Faites défiler pour remplir le formulaire'
                  : '↓ Continuez l’intervention'}
              </span>
            </article>
          ))}
        </div>
      </section>
      <section className="landing-outro">
        <p className="landing-eyebrow">LE MÊME GARAGE, TOUTE VOTRE GESTION</p>
        <h2>
          Une vue d’ensemble.
          <br />
          Chaque détail à portée de main.
        </h2>
        <p>Clients, interventions, équipe et pièces : gardez le fil de votre atelier.</p>
        <Button
          className="primary"
          onClick={() => {
            setFree(true);
            setScreen('garage');
            document.querySelector('#histoire')?.scrollIntoView();
          }}
        >
          Explorer le garage de démonstration ↗
        </Button>
        <p className="landing-demo-note">Données fictives · Actions locales · Sans inscription</p>
      </section>
      {notice && (
        <div className="toast" role="status" onClick={() => setNotice('')}>
          {notice}
          <button aria-label="Fermer" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
      {dialog === 'customer' && free && <CustomerForm close={() => setDialog('')} />}
      {dialog === 'arrival' && free && <VehicleForm close={() => setDialog('')} />}
      {dialog === 'vehicle' && selected && state.vehicles.some((v) => v.id === selected) && (
        <VehicleDrawer id={selected} close={() => setDialog('')} />
      )}
    </GarageContext.Provider>
  );
}
