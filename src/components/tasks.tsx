'use client';
import { useState } from 'react';
import { Check, Play, UserPlus, Users, Clock3, RotateCcw, ArrowUpRight } from 'lucide-react';
import type { Task, Vehicle } from '@/lib/domain';
import { roleLabel } from '@/lib/permissions';
import { useGarage } from './provider';
import { Avatar, Badge, Button, Empty, Field, Form, Modal, number } from './ui';

export function TaskCard({
  task,
  vehicle,
  showVehicle,
  selectVehicle,
}: {
  task: Task;
  vehicle: Vehicle;
  showVehicle?: boolean;
  selectVehicle?: (id: string) => void;
}) {
  const { state, user, act, notify, can } = useGarage();
  const [assign, setAssign] = useState(false);
  const [finish, setFinish] = useState(false);
  const [estimate, setEstimate] = useState(false);
  const [busy, setBusy] = useState(false);
  const managed = can('tasks.manage');
  const work = can('tasks.work');
  const mine = task.assignees.includes(user.id);
  const editable = vehicle.stage !== 'returned' && vehicle.stage !== 'ready';
  async function action(operation: 'claim' | 'start' | 'reopen') {
    setBusy(true);
    try {
      await act({
        type: 'task',
        vehicleId: vehicle.id,
        taskId: task.id,
        operation,
      });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className={`task-card ${task.status}`}>
        <div className="task-card-top">
          <span className={`task-status ${task.status}`}>
            {task.status === 'done' ? (
              <Check size={16} />
            ) : task.status === 'doing' ? (
              <Play size={14} />
            ) : (
              <span />
            )}
          </span>
          <div className="task-title">
            {showVehicle && (
              <button onClick={() => selectVehicle?.(vehicle.id)} className="task-vehicle">
                {vehicle.plate} <span>{vehicle.model}</span>
                <ArrowUpRight size={13} />
              </button>
            )}
            <strong>{task.title}</strong>
          </div>
          <Badge tone={task.status === 'done' ? 'green' : task.status === 'doing' ? 'blue' : ''}>
            {task.status === 'done' ? 'Terminé' : task.status === 'doing' ? 'En cours' : 'À faire'}
          </Badge>
        </div>
        {showVehicle && vehicle.blocker && (
          <p className="task-blocker">En attente · {vehicle.blocker}</p>
        )}
        <div className="task-card-bottom">
          <div className="task-assignees">
            {task.assignees.length ? (
              task.assignees.map((id) => {
                const u = state.users.find((u) => u.id === id)!;
                return (
                  <span key={id}>
                    <Avatar name={u.name} color={u.color} small />
                    <small>{u.name.split(' ')[0]}</small>
                  </span>
                );
              })
            ) : (
              <span className="muted">
                <Users size={14} /> Non attribuée
              </span>
            )}
            {task.minutes > 0 && (
              <span className="muted">
                <Clock3 size={13} />
                {task.minutes} min
              </span>
            )}
          </div>
          <div className="task-actions">
            {editable && (
              <>
                {managed && (
                  <button
                    className="icon-button"
                    title="Attribuer les intervenants"
                    aria-label="Attribuer les intervenants"
                    onClick={() => setAssign(true)}
                  >
                    <UserPlus size={16} />
                  </button>
                )}
                {work && !task.assignees.length && task.status !== 'done' && (
                  <Button busy={busy} onClick={() => action('claim')}>
                    Prendre
                  </Button>
                )}
                {work &&
                  (mine || managed) &&
                  task.status === 'todo' &&
                  (vehicle.stage === 'workshop' || can('vehicles.stage')) && (
                    <Button busy={busy} onClick={() => action('start')}>
                      <Play size={13} />
                      Commencer
                    </Button>
                  )}
                {work && (mine || managed) && task.status === 'doing' && (
                  <Button className="primary" onClick={() => setFinish(true)}>
                    <Check size={14} />
                    Terminer
                  </Button>
                )}
                {work && (mine || managed) && task.status === 'done' && (
                  <button
                    className="icon-button"
                    title="Rouvrir la tâche"
                    aria-label="Rouvrir la tâche"
                    onClick={() => action('reopen')}
                  >
                    <RotateCcw size={15} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        <div className="task-time-plan">
          <span>
            Prévu :{' '}
            {task.estimatedMinutes === undefined ? 'à estimer' : `${task.estimatedMinutes} min`} ·
            Passé saisi : {task.minutes} min
          </span>
          {managed && editable && (
            <Button aria-label={`Estimer ${task.title}`} onClick={() => setEstimate(true)}>
              Temps prévu
            </Button>
          )}
        </div>
      </div>
      {estimate && managed && (
        <Modal title="Estimer le travail" subtitle={task.title} close={() => setEstimate(false)}>
          <Form
            label="Enregistrer l’estimation"
            onSubmit={async (f) => {
              const raw = f.get('estimatedMinutes');
              await act({
                type: 'estimateTask',
                vehicleId: vehicle.id,
                taskId: task.id,
                minutes: raw === '' || raw === null ? undefined : Number(raw),
              });
              setEstimate(false);
            }}
          >
            <Field
              label="Temps prévu (minutes)"
              hint="Laissez vide si la durée n’est pas encore connue."
            >
              <input
                name="estimatedMinutes"
                type="number"
                min={0}
                max={100000}
                defaultValue={task.estimatedMinutes ?? ''}
              />
            </Field>
          </Form>
        </Modal>
      )}
      {assign && managed && (
        <Modal title="Attribuer les travaux" subtitle={task.title} close={() => setAssign(false)}>
          <Form
            onSubmit={async (f) => {
              await act({
                type: 'task',
                vehicleId: vehicle.id,
                taskId: task.id,
                operation: 'assign',
                assignees: f.getAll('assignees').map(String),
              });
              setAssign(false);
            }}
          >
            {state.users.map((u) => (
              <label className="user-check" key={u.id}>
                <Avatar name={u.name} color={u.color} />
                <span>
                  <strong>{u.name}</strong>
                  <small>{roleLabel(state, u)}</small>
                </span>
                <input
                  name="assignees"
                  type="checkbox"
                  value={u.id}
                  defaultChecked={task.assignees.includes(u.id)}
                />
              </label>
            ))}
          </Form>
        </Modal>
      )}
      {finish && work && (
        <Modal title="Terminer le travail" subtitle={task.title} close={() => setFinish(false)}>
          <Form
            label="Marquer comme terminé"
            onSubmit={async (f) => {
              await act({
                type: 'task',
                vehicleId: vehicle.id,
                taskId: task.id,
                operation: 'finish',
                minutes: number(f, 'minutes'),
              });
              setFinish(false);
            }}
          >
            <Field label="Temps total passé (minutes)">
              <input
                name="minutes"
                type="number"
                required
                min={0}
                max={100000}
                defaultValue={task.minutes}
              />
            </Field>
            <p className="muted">
              Les autres tâches restent ouvertes. Le véhicule sera déclaré prêt après validation du
              contrôle.
            </p>
          </Form>
        </Modal>
      )}
    </>
  );
}
export function TasksScreen({ selectVehicle }: { selectVehicle: (id: string) => void }) {
  const { state, user } = useGarage();
  const [filter, setFilter] = useState('mine');
  const all = state.vehicles
    .filter((v) => v.stage !== 'returned')
    .flatMap((v) => v.tasks.map((t) => ({ t, v })));
  const mine = all.filter((x) => x.t.assignees.includes(user.id));
  const unassigned = all.filter((x) => !x.t.assignees.length && x.t.status !== 'done');
  const selected = filter === 'mine' ? mine : filter === 'available' ? unassigned : all;
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Une chose à la fois. Ensemble.</h2>
          <p>Bonjour {user.name.split(' ')[0]}, voici les travaux qui vous attendent.</p>
        </div>
        <Badge tone="blue">
          {mine.filter((x) => x.t.status !== 'done').length} tâches à terminer
        </Badge>
      </div>
      <div className="task-tabs segmented">
        <button className={filter === 'mine' ? 'active' : ''} onClick={() => setFilter('mine')}>
          Mon travail <b>{mine.length}</b>
        </button>
        <button
          className={filter === 'available' ? 'active' : ''}
          onClick={() => setFilter('available')}
        >
          Disponibles <b>{unassigned.length}</b>
        </button>
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          Toute l’équipe
        </button>
      </div>
      {selected.length ? (
        <div className="task-columns">
          {(['doing', 'todo', 'done'] as const).map((status) => (
            <section className="task-column" key={status}>
              <h3>
                <i className={status} />
                {status === 'doing' ? 'En cours' : status === 'todo' ? 'À faire' : 'Terminées'}
                <span>{selected.filter((x) => x.t.status === status).length}</span>
              </h3>
              {selected
                .filter((x) => x.t.status === status)
                .map(({ t, v }) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    vehicle={v}
                    showVehicle
                    selectVehicle={selectVehicle}
                  />
                ))}
              {!selected.some((x) => x.t.status === status) && (
                <p className="column-empty">Aucune tâche ici.</p>
              )}
            </section>
          ))}
        </div>
      ) : (
        <Empty
          title="La voie est libre"
          text={
            filter === 'mine'
              ? 'Consultez les tâches disponibles pour prendre un véhicule en charge.'
              : 'Les tâches des nouveaux dossiers apparaîtront ici.'
          }
          action={
            filter === 'mine' && (
              <Button onClick={() => setFilter('available')}>Voir les tâches disponibles</Button>
            )
          }
        />
      )}
    </>
  );
}
