'use client';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import {
  Layers3,
  CarFront,
  ArrowUpRight,
  Clock3,
  CircleCheck,
  Wrench,
  AlertTriangle,
  SlidersHorizontal,
  Radio,
  ArrowRight,
  Check,
} from 'lucide-react';
import { capacity, stages, type Vehicle } from '@/lib/domain';
import { useGarage } from './provider';
import { Badge, Empty } from './ui';

const GarageScene = dynamic(() => import('./garage-scene'), {
  ssr: false,
  loading: () => (
    <div className="scene-loading">
      <span className="brand-mark">
        <Layers3 />
      </span>
      <p>Votre atelier prend forme…</p>
    </div>
  ),
});

export function Dashboard({
  search,
  selected,
  selectVehicle,
  configure,
  navigate,
}: {
  search: string;
  selected: string | null;
  selectVehicle: (id: string) => void;
  configure: () => void;
  navigate: (s: string) => void;
}) {
  const { state, user } = useGarage();
  const [filter, setFilter] = useState('all');
  const [focus, setFocus] = useState('all');
  const [activity, setActivity] = useState(true);
  const vehicles = state.vehicles.filter((v) => v.stage !== 'returned');
  const blocked = vehicles.filter((v) => v.blocker);
  const ready = vehicles.filter((v) => v.stage === 'ready');
  const active = vehicles.filter((v) => v.stage === 'workshop');
  const matches = (v: Vehicle) => {
    const q =
      `${v.plate} ${v.model} ${state.customers.find((c) => c.id === v.customerId)?.name}`.toLowerCase();
    return (
      q.includes(search.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'mine'
          ? v.tasks.some((t) => t.assignees.includes(user.id))
          : filter === 'blocked'
            ? Boolean(v.blocker)
            : v.priority))
    );
  };
  const displayed = vehicles.filter(matches);
  const stats = [
    {
      title: 'Véhicules au garage',
      value: vehicles.length,
      icon: CarFront,
      color: 'blue',
      hint: 'Une vue sur toute l’activité',
      click: () => {
        setFilter('all');
        setFocus('all');
      },
    },
    {
      title: 'En intervention',
      value: active.length,
      icon: Wrench,
      color: 'violet',
      hint: `${state.users.filter((u) => u.role === 'mechanic').length} mécaniciens dans l’équipe`,
      click: () => setFocus('workshop'),
    },
    {
      title: 'En attente d’une action',
      value: blocked.length,
      icon: Clock3,
      color: 'amber',
      hint: 'Accords clients et pièces attendues',
      click: () => setFilter('blocked'),
    },
    {
      title: 'Prêts à retrouver la route',
      value: ready.length,
      icon: CircleCheck,
      color: 'green',
      hint: 'Véhicules à récupérer',
      click: () => setFocus('ready'),
    },
  ];
  return (
    <>
      <div className="stats-row">
        {stats.map((s) => (
          <button className={`stat-card ${s.color}`} key={s.title} onClick={s.click}>
            <div>
              <span>{s.title}</span>
              <s.icon size={19} strokeWidth={1.7} />
            </div>
            <strong>{String(s.value).padStart(2, '0')}</strong>
            <small>
              <i />
              {s.hint}
            </small>
          </button>
        ))}
      </div>
      <section className="garage-panel">
        <div className="garage-toolbar">
          <div className="segmented">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              Tous les véhicules <b>{vehicles.length}</b>
            </button>
            <button className={filter === 'mine' ? 'active' : ''} onClick={() => setFilter('mine')}>
              Mes véhicules
            </button>
            <button
              className={filter === 'blocked' ? 'active' : ''}
              onClick={() => setFilter('blocked')}
            >
              <AlertTriangle size={13} />
              Blocages{blocked.length > 0 && <b>{blocked.length}</b>}
            </button>
            <button
              className={filter === 'priority' ? 'active' : ''}
              onClick={() => setFilter('priority')}
            >
              Prioritaires
            </button>
          </div>
          <div className="garage-toolbar-right">
            <button
              className={`text-button ${activity ? 'selected' : ''}`}
              onClick={() => setActivity(!activity)}
            >
              <Radio size={15} />
              Activité
            </button>
            {user.role === 'owner' && (
              <button className="button" onClick={configure}>
                <SlidersHorizontal size={15} />
                <span>Organiser le garage</span>
              </button>
            )}
          </div>
        </div>
        <div className={`garage-view ${activity ? '' : 'no-activity'}`}>
          <div className="garage-main">
            <GarageScene
              state={state}
              selected={selected}
              onSelect={selectVehicle}
              filter={matches}
              focus={focus}
              setFocus={setFocus}
              onOpenStock={() => navigate('inventory')}
            />
            <div className="zone-summary">
              {stages.map((st) => {
                const n = vehicles.filter((v) => v.stage === st.id).length;
                const cap = capacity(st.id, state.settings.modules[st.id]);
                return (
                  <button
                    key={st.id}
                    onClick={() => setFocus(focus === st.id ? 'all' : st.id)}
                    className={focus === st.id ? 'selected' : ''}
                  >
                    <span>
                      <i style={{ background: st.color }} />
                      {st.short}
                    </span>
                    <strong>
                      {n}
                      <small> / {cap}</small>
                    </strong>
                    <div className="zone-meter">
                      <i
                        style={{
                          background: st.color,
                          width: `${Math.min((n / cap) * 100, 100)}%`,
                        }}
                      />
                    </div>
                    {n > cap && <small className="overflow-label">Capacité étendue</small>}
                  </button>
                );
              })}
            </div>
          </div>
          {activity && (
            <aside className="activity-panel">
              <div className="activity-heading">
                <h3>En mouvement</h3>
                <span className="live-dot" />
              </div>
              <p>Le fil de votre atelier</p>
              <div className="activity-list">
                {state.activity.slice(0, 6).map((a, i) => (
                  <article key={a.id}>
                    <span className={`activity-event-icon event-${i % 3}`}>
                      {i % 3 === 0 ? (
                        <Wrench size={14} />
                      ) : i % 3 === 1 ? (
                        <Check size={14} />
                      ) : (
                        <Clock3 size={14} />
                      )}
                    </span>
                    <div>
                      <p>{a.text}</p>
                      <small>
                        {a.author.split(' ')[0]} ·{' '}
                        {new Date(a.at).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    </div>
                  </article>
                ))}
                {!state.activity.length && (
                  <p className="muted">L’activité de votre équipe apparaîtra ici.</p>
                )}
              </div>
              <div className="activity-tip">
                <span>UN ATELIER QUI AVANCE</span>
                <p>
                  {ready.length
                    ? `${ready.length} véhicule${ready.length > 1 ? 's' : ''} prêt${ready.length > 1 ? 's' : ''} à reprendre la route.`
                    : 'Votre prochain départ commence ici.'}
                </p>
                <button onClick={() => navigate('messages')}>
                  Préparer la suite
                  <ArrowUpRight size={14} />
                </button>
              </div>
            </aside>
          )}
        </div>
      </section>
      <div className="below-garage">
        <section className="vehicle-strip-panel">
          <div className="panel-section-head">
            <div>
              <h2>
                {filter === 'all'
                  ? 'À suivre aujourd’hui'
                  : filter === 'mine'
                    ? 'Mes véhicules'
                    : filter === 'blocked'
                      ? 'Les dossiers à débloquer'
                      : 'Les priorités de l’atelier'}
              </h2>
              <span>
                {displayed.length} véhicules{search && ' trouvés'}
              </span>
            </div>
            <button className="text-button" onClick={() => navigate('vehicles')}>
              Tout voir
              <ArrowRight size={15} />
            </button>
          </div>
          <div className="vehicle-strip">
            {displayed.slice(0, 6).map((v) => (
              <button className="vehicle-mini-card" key={v.id} onClick={() => selectVehicle(v.id)}>
                <div className="mini-card-top">
                  <span
                    className="vehicle-card-icon"
                    style={{ color: v.color, background: v.color + '18' }}
                  >
                    <CarFront size={30} strokeWidth={1.5} />
                  </span>
                  <Badge tone={v.blocker ? 'amber' : v.stage === 'ready' ? 'green' : 'blue'}>
                    {v.blocker ? 'En attente' : stages.find((s) => s.id === v.stage)?.short}
                  </Badge>
                </div>
                <h3>{v.model}</h3>
                <span className="plate-small">{v.plate}</span>
                <p>{v.issue}</p>
                <div className="mini-card-bottom">
                  <span>
                    {state.customers
                      .find((c) => c.id === v.customerId)
                      ?.name.split(' ')
                      .map((n, i) => (i ? n[0] + '.' : n))
                      .join(' ')}
                  </span>
                  <ArrowUpRight size={15} />
                </div>
              </button>
            ))}
            {!displayed.length && (
              <Empty
                title="Aucun véhicule dans cette sélection"
                text="Changez de filtre ou enregistrez une nouvelle arrivée."
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
}
