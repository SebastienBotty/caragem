'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useGarage } from '../provider';
import { Badge, Button } from '../ui';
import { AppointmentForm } from '../forms';

export function PlanningScreen({ selectVehicle }: { selectVehicle: (id: string) => void }) {
  const { state, can, act, notify } = useGarage();
  const [create, setCreate] = useState(false);
  const [offset, setOffset] = useState(0);
  const days = Array.from({ length: 5 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + offset + i);
    return d;
  });
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Une semaine qui tourne rond.</h2>
          <p>Rendez-vous à venir et restitutions prévues.</p>
        </div>
        {can('planning.manage') && (
          <Button className="primary" onClick={() => setCreate(true)}>
            <Plus size={16} />
            Nouveau rendez-vous
          </Button>
        )}
      </div>
      <div className="planning-toolbar">
        <Button onClick={() => setOffset((o) => o - 5)}>← Précédents</Button>
        <Button onClick={() => setOffset(0)}>Aujourd’hui</Button>
        <Button onClick={() => setOffset((o) => o + 5)}>Suivants →</Button>
        <span>
          <i className="dot blue" /> Arrivées <i className="dot green" /> Restitutions
        </span>
      </div>
      <div className="planning-grid">
        {days.map((d) => {
          const key = d.toDateString();
          const appointments = state.appointments.filter(
            (a) => new Date(a.at).toDateString() === key,
          );
          const returns = state.vehicles.filter(
            (v) => v.stage !== 'returned' && new Date(v.due).toDateString() === key,
          );
          return (
            <section
              className={`planning-day ${key === new Date().toDateString() ? 'today' : ''}`}
              key={key}
            >
              <header>
                <span>{d.toLocaleDateString('fr-FR', { weekday: 'long' })}</span>
                <strong>{d.getDate()}</strong>
                <small>{d.toLocaleDateString('fr-FR', { month: 'long' })}</small>
              </header>
              <div className="planning-events">
                {appointments.map((a) => (
                  <article className="appointment" key={a.id}>
                    <span>
                      {new Date(a.at).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      <Badge tone={a.arrived ? 'green' : 'blue'}>
                        {a.arrived ? 'Arrivé' : 'Rendez-vous'}
                      </Badge>
                    </span>
                    <h4>{a.model}</h4>
                    <strong className="mono">{a.plate}</strong>
                    <p>{a.reason}</p>
                    <small>{state.customers.find((c) => c.id === a.customerId)?.name}</small>
                    {!a.arrived && can('vehicles.create') && (
                      <Button
                        onClick={async () => {
                          try {
                            await act({ type: 'arrive', id: a.id });
                            notify('Arrivée enregistrée dans le garage.');
                          } catch (e) {
                            notify((e as Error).message);
                          }
                        }}
                      >
                        Véhicule arrivé
                      </Button>
                    )}
                  </article>
                ))}
                {returns.map((v) => (
                  <button className="return-event" key={v.id} onClick={() => selectVehicle(v.id)}>
                    <span>
                      {new Date(v.due).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      · Restitution prévue
                    </span>
                    <strong>{v.model}</strong>
                    <small>{v.plate}</small>
                  </button>
                ))}
                {!appointments.length && !returns.length && (
                  <p className="column-empty">Planning disponible</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {create && can('planning.manage') && <AppointmentForm close={() => setCreate(false)} />}
    </>
  );
}
