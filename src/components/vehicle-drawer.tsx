'use client';
import { useEffect, useRef, useState } from 'react';
import {
  X,
  CarFront,
  Phone,
  Mail,
  Clock3,
  Plus,
  AlertTriangle,
  ChevronRight,
  Check,
  FileText,
  ArrowRight,
  Package,
  Send,
} from 'lucide-react';
import { available, money, stages, type Stage, type Vehicle } from '@/lib/domain';
import { useGarage } from './provider';
import { Badge, Button, Field, Form, Modal, formatDate, number, value } from './ui';
import { TaskCard } from './tasks';
import { DocumentDetail, DocumentForm } from './documents';
import { ReturnVisit } from './forms';
import { VehicleColor } from './vehicle-color';
import { VehicleBlocker } from './vehicle-blocker';
import { VehiclePhotos } from './vehicle-photos';
import { VehicleTimeSummary } from './vehicle-time-summary';

export function VehicleDrawer({ id, close }: { id: string; close: () => void }) {
  const { state, can, act, notify } = useGarage();
  const v = state.vehicles.find((v) => v.id === id)!;
  const c = state.customers.find((c) => c.id === v.customerId)!;
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState('work');
  const [dialog, setDialog] = useState('');
  const [docId, setDocId] = useState('');
  const [stage, setStage] = useState<Stage>(v.stage);
  const [busy, setBusy] = useState(false);
  const isClosed = v.stage === 'returned';
  const done = v.tasks.filter((t) => t.status === 'done').length;
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  useEffect(() => setStage(v.stage), [v.stage]);
  async function changeStage() {
    setBusy(true);
    try {
      await act({ type: 'stage', id: v.id, stage });
      notify('Étape du véhicule mise à jour.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const docs = state.documents.filter((d) => d.vehicleId === v.id);
  const reservations = state.reservations.filter((r) => r.vehicleId === v.id);
  const history = state.vehicles.filter((x) => x.plate === v.plate && x.id !== v.id);
  return (
    <>
      <dialog
        ref={ref}
        className="vehicle-drawer"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="drawer-inner">
          <header className="drawer-head">
            <span className="eyebrow">DOSSIER VÉHICULE · VISITE {v.visit}</span>
            <button className="icon-button" aria-label="Fermer le dossier" onClick={close}>
              <X size={20} />
            </button>
          </header>
          <div className="drawer-vehicle">
            <span className="vehicle-symbol" style={{ color: v.color, background: v.color + '1c' }}>
              <CarFront size={43} strokeWidth={1.4} />
            </span>
            <div>
              <h2>{v.model}</h2>
              <span className="plate">{v.plate}</span>
              <span className="mileage">{v.mileage.toLocaleString('fr-FR')} km</span>
            </div>
            {v.priority && <Badge tone="red">Prioritaire</Badge>}
          </div>
          <div className="drawer-client">
            <div>
              <strong>{c.name}</strong>
              <small>{c.email}</small>
            </div>
            {can('customers.view') && (
              <a href={`tel:${c.phone}`} className="icon-button" title="Appeler le client">
                <Phone size={16} />
              </a>
            )}
            {can('mail.send') && (
              <button
                className="icon-button"
                title="Préparer un mail"
                aria-label="Préparer un mail"
                onClick={() => setDialog('mail')}
              >
                <Mail size={17} />
              </button>
            )}
          </div>
          <div className="drawer-stage">
            <span>
              <i
                style={{
                  background: stages.find((s) => s.id === v.stage)?.color ?? '#8993a1',
                }}
              />
              {stages.find((s) => s.id === v.stage)?.label ?? 'Remis au client'}
            </span>
            <small>
              <Clock3 size={13} />
              {formatDate(v.due)}
            </small>
          </div>
          <VehicleColor vehicle={v} />
          <VehicleBlocker
            vehicle={v}
            open={dialog === 'blocker'}
            edit={() => setDialog('blocker')}
            close={() => setDialog('')}
          />
          <div className="drawer-tabs">
            {[
              ['work', 'Travaux'],
              ['notes', 'Notes'],
              ['photos', 'Photos'],
              ['parts', 'Pièces'],
              ['docs', 'Documents'],
              ['history', 'Historique'],
            ]
              .filter(([key]) =>
                key === 'parts'
                  ? can('stock.view')
                  : key === 'docs'
                    ? can('documents.view') || can('mail.send')
                    : key === 'history'
                      ? can('history.view')
                      : true,
              )
              .map(([key, label]) => (
                <button
                  key={key}
                  className={tab === key ? 'active' : ''}
                  onClick={() => setTab(key)}
                >
                  {label}
                  {key === 'work' && <span>{v.tasks.length}</span>}
                </button>
              ))}
          </div>
          <div className="drawer-content">
            {tab === 'photos' && <VehiclePhotos vehicle={v} />}
            {tab === 'work' && (
              <>
                <VehicleTimeSummary vehicle={v} />
                <div className="drawer-section-title">
                  <h3>Travaux à réaliser</h3>
                  <span>
                    {done}/{v.tasks.length}
                  </span>
                </div>
                <div className="progress-track">
                  <i
                    style={{
                      width: `${v.tasks.length ? (done / v.tasks.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <p className="vehicle-issue">{v.issue}</p>
                {v.tasks.map((t) => (
                  <TaskCard key={t.id} task={t} vehicle={v} />
                ))}
                {!isClosed && v.stage !== 'ready' && can('tasks.manage') && (
                  <button className="add-dashed" onClick={() => setDialog('task')}>
                    <Plus size={16} /> Ajouter un travail
                  </button>
                )}
                {!isClosed && (
                  <div className="drawer-work-actions">
                    {can('vehicles.edit') && (
                      <Button onClick={() => setDialog('blocker')}>
                        <AlertTriangle size={15} />
                        {v.blocker ? 'Modifier le blocage' : 'Signaler un blocage'}
                      </Button>
                    )}
                    {can('vehicles.stage') &&
                      v.tasks.every((t) => t.status === 'done') &&
                      !v.blocker &&
                      v.stage !== 'ready' && (
                        <Button
                          className="primary"
                          onClick={async () => {
                            try {
                              await act({
                                type: 'stage',
                                id: v.id,
                                stage: 'ready',
                              });
                            } catch (e) {
                              notify((e as Error).message);
                            }
                          }}
                        >
                          <Check size={15} />
                          Valider le contrôle
                        </Button>
                      )}
                  </div>
                )}
              </>
            )}
            {tab === 'notes' && (
              <>
                {!isClosed && can('vehicles.edit') && (
                  <Form
                    label="Ajouter la note"
                    onSubmit={async (f) => {
                      await act({
                        type: 'note',
                        id: v.id,
                        text: value(f, 'text'),
                      });
                      notify('Note ajoutée.');
                    }}
                  >
                    <Field label="Une information pour l’équipe">
                      <textarea
                        name="text"
                        required
                        maxLength={4000}
                        placeholder="Observations, informations du client…"
                        rows={3}
                      />
                    </Field>
                  </Form>
                )}
                <div className="note-list">
                  {v.notes.map((n) => (
                    <article key={n.id}>
                      <div>
                        <strong>{n.author}</strong>
                        <small>{formatDate(n.at)}</small>
                      </div>
                      <p>{n.text}</p>
                    </article>
                  ))}
                </div>
              </>
            )}
            {tab === 'parts' && can('stock.view') && (
              <>
                <div className="drawer-section-title">
                  <h3>Pièces du dossier</h3>
                  {!isClosed && can('stock.reserve') && (
                    <button className="text-button" onClick={() => setDialog('reserve')}>
                      <Plus size={14} />
                      Réserver
                    </button>
                  )}
                </div>
                {!reservations.length && (
                  <p className="muted">
                    Aucune pièce réservée ou utilisée pour cette intervention.
                  </p>
                )}
                {reservations.map((r) => {
                  const p = state.parts.find((p) => p.id === r.partId)!;
                  return (
                    <div className="reservation-card" key={r.id}>
                      <Package size={20} />
                      <div>
                        <strong>{p.name}</strong>
                        <small>
                          {r.quantity} × {money(p.price)} HT
                        </small>
                      </div>
                      {r.consumed ? (
                        <Badge tone="green">Utilisée</Badge>
                      ) : (
                        !isClosed && (
                          <div>
                            {can('stock.consume') && (
                              <Button
                                onClick={async () => {
                                  try {
                                    await act({ type: 'consume', id: r.id });
                                  } catch (e) {
                                    notify((e as Error).message);
                                  }
                                }}
                              >
                                Montée
                              </Button>
                            )}
                            {can('stock.reserve') && (
                              <button
                                className="text-button"
                                onClick={async () => {
                                  try {
                                    await act({ type: 'release', id: r.id });
                                  } catch (e) {
                                    notify((e as Error).message);
                                  }
                                }}
                              >
                                Libérer
                              </button>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
                <h3 className="subsection-heading">Commandes liées</h3>
                {state.orders
                  .filter((o) => o.vehicleId === v.id)
                  .map((o) => (
                    <div className="compact-row" key={o.id}>
                      <span>
                        {o.reference}
                        <small>
                          {o.supplier} · {formatDate(o.due, false)}
                        </small>
                      </span>
                      <Badge tone={o.received === o.quantity ? 'green' : 'amber'}>
                        {o.received}/{o.quantity} reçues
                      </Badge>
                    </div>
                  ))}
                {!state.orders.some((o) => o.vehicleId === v.id) && (
                  <p className="muted">Aucune commande liée.</p>
                )}
              </>
            )}
            {tab === 'docs' && (can('documents.view') || can('mail.send')) && (
              <>
                <div className="drawer-section-title">
                  <h3>Devis et factures</h3>
                  {can('documents.prepare') && (
                    <div>
                      <button className="text-button" onClick={() => setDialog('estimate')}>
                        + Devis
                      </button>
                      <button className="text-button" onClick={() => setDialog('invoice')}>
                        + Facture
                      </button>
                    </div>
                  )}
                </div>
                {docs.map((d) => (
                  <button className="document-row" key={d.id} onClick={() => setDocId(d.id)}>
                    <span className="document-icon">
                      <FileText size={20} />
                    </span>
                    <div>
                      <strong>{d.number}</strong>
                      <small>{d.kind === 'estimate' ? 'Devis' : 'Facture'} · Brouillon</small>
                    </div>
                    <ChevronRight size={16} />
                  </button>
                ))}
                {!docs.length && <p className="muted">Aucun document pour cette visite.</p>}
                <h3 className="subsection-heading">Mails du dossier</h3>
                {state.mails
                  .filter((m) => m.vehicleId === v.id)
                  .map((m) => (
                    <div className="compact-row" key={m.id}>
                      <span>{m.subject}</span>
                      <Badge tone={m.status === 'sent' ? 'green' : 'amber'}>
                        {m.status === 'sent' ? 'Envoyé' : 'À valider'}
                      </Badge>
                    </div>
                  ))}
                {can('mail.send') && (
                  <button className="add-dashed" onClick={() => setDialog('mail')}>
                    <Mail size={16} />
                    Préparer un mail
                  </button>
                )}
              </>
            )}
            {tab === 'history' && can('history.view') && (
              <>
                <h3>Historique du véhicule</h3>
                <div className="history-event">
                  <i />
                  <div>
                    <strong>Visite actuelle · {formatDate(v.createdAt, false)}</strong>
                    <p>{v.issue}</p>
                  </div>
                </div>
                {history.map((old) => (
                  <div key={old.id} className="history-event">
                    <i />
                    <div>
                      <strong>
                        Visite {old.visit} · {formatDate(old.createdAt, false)}
                      </strong>
                      <p>{old.issue}</p>
                      <small>
                        {old.tasks.filter((t) => t.status === 'done').length} travaux terminés
                      </small>
                    </div>
                  </div>
                ))}
                <h3 className="subsection-heading">Journal de l’équipe</h3>
                {state.activity
                  .filter((e) => e.text.includes(v.plate))
                  .slice(0, 15)
                  .map((e) => (
                    <div key={e.id} className="activity-item">
                      <i />
                      <div>
                        <p>{e.text}</p>
                        <small>
                          {e.author} · {formatDate(e.at)}
                        </small>
                      </div>
                    </div>
                  ))}
              </>
            )}
          </div>
          <footer className="drawer-footer">
            {isClosed ? (
              <>
                <Badge tone="green">Visite clôturée</Badge>
                {can('vehicles.create') && (
                  <Button className="primary" onClick={() => setDialog('revisit')}>
                    Nouvelle visite
                    <Plus size={15} />
                  </Button>
                )}
              </>
            ) : (
              <>
                <select
                  aria-label="Étape du véhicule"
                  disabled={!can('vehicles.stage') && !can('vehicles.return')}
                  value={stage}
                  onChange={(e) => setStage(e.target.value as Stage)}
                >
                  {stages.map((s) => (
                    <option value={s.id} key={s.id} disabled={!can('vehicles.stage')}>
                      {s.label}
                    </option>
                  ))}
                  {can('vehicles.return') && <option value="returned">Remis au client</option>}
                </select>
                <Button
                  className="primary"
                  disabled={
                    stage === v.stage ||
                    !can(stage === 'returned' ? 'vehicles.return' : 'vehicles.stage')
                  }
                  busy={busy}
                  onClick={changeStage}
                >
                  Déplacer
                  <ArrowRight size={15} />
                </Button>
              </>
            )}
          </footer>
        </div>
      </dialog>
      {dialog === 'task' && can('tasks.manage') && (
        <Modal title="Ajouter un travail" close={() => setDialog('')}>
          <Form
            onSubmit={async (f) => {
              await act({
                type: 'addTask',
                vehicleId: v.id,
                title: value(f, 'title'),
                estimatedMinutes:
                  value(f, 'estimatedMinutes') === '' ? undefined : number(f, 'estimatedMinutes'),
              });
              setDialog('');
            }}
          >
            <Field label="Travail à réaliser">
              <input
                name="title"
                required
                maxLength={200}
                placeholder="Contrôle final, remplacement du filtre…"
              />
            </Field>
            <Field label="Temps prévu (minutes)">
              <input name="estimatedMinutes" type="number" min={0} max={100000} />
            </Field>
          </Form>
        </Modal>
      )}
      {dialog === 'reserve' && can('stock.reserve') && (
        <Modal title="Réserver une pièce" close={() => setDialog('')}>
          <Form
            onSubmit={async (f) => {
              await act({
                type: 'reserve',
                vehicleId: v.id,
                partId: value(f, 'partId'),
                quantity: number(f, 'quantity'),
              });
              setDialog('');
            }}
          >
            <Field label="Pièce en stock">
              <select name="partId" required>
                <option value="">Sélectionner</option>
                {state.parts.map((p) => (
                  <option key={p.id} value={p.id} disabled={available(state, p.id) <= 0}>
                    {p.name} · {available(state, p.id)} disponibles
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantité">
              <input name="quantity" type="number" required min={1} max={10000} defaultValue={1} />
            </Field>
          </Form>
        </Modal>
      )}
      {(dialog === 'estimate' || dialog === 'invoice') && can('documents.prepare') && (
        <DocumentForm kind={dialog} vehicleId={v.id} close={() => setDialog('')} />
      )}
      {dialog === 'revisit' && can('vehicles.create') && (
        <ReturnVisit vehicle={v} close={() => setDialog('')} />
      )}
      {dialog === 'mail' && can('mail.send') && (
        <MailComposer vehicle={v} close={() => setDialog('')} />
      )}
      {docId && state.documents.some((d) => d.id === docId) && (
        <DocumentDetail
          document={state.documents.find((d) => d.id === docId)!}
          close={() => setDocId('')}
        />
      )}
    </>
  );
}
export function MailComposer({ vehicle, close }: { vehicle: Vehicle; close: () => void }) {
  const { state, act } = useGarage();
  const c = state.customers.find((c) => c.id === vehicle.customerId)!;
  const ready = vehicle.stage === 'ready';
  return (
    <Modal
      title="Préparer un mail"
      subtitle="Ce message sera enregistré en brouillon. Son envoi nécessite une validation."
      close={close}
    >
      <Form
        label="Enregistrer le brouillon"
        onSubmit={async (f) => {
          await act({
            type: 'mail',
            documentId: value(f, 'documentId') || undefined,
            vehicleId: vehicle.id,
            to: value(f, 'to'),
            subject: value(f, 'subject'),
            body: value(f, 'body'),
          });
          close();
        }}
      >
        <Field label="Destinataire">
          <input name="to" type="email" required defaultValue={c.email} />
        </Field>
        <Field label="Document joint en PDF">
          <select name="documentId">
            <option value="">Aucune pièce jointe</option>
            {state.documents
              .filter((d) => d.vehicleId === vehicle.id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.number} · Brouillon
                </option>
              ))}
          </select>
        </Field>
        <Field label="Objet">
          <input
            name="subject"
            required
            maxLength={200}
            defaultValue={
              ready
                ? `Votre ${vehicle.model} est prête à récupérer`
                : `Suivi de votre ${vehicle.model} · ${vehicle.plate}`
            }
          />
        </Field>
        <Field label="Message">
          <textarea
            name="body"
            required
            rows={9}
            maxLength={10000}
            defaultValue={`Bonjour ${c.name.split(' ')[0]},\n\n${ready ? `Les travaux sur votre ${vehicle.model} sont terminés. Vous pouvez venir récupérer votre véhicule au garage.` : `Nous vous contactons au sujet de votre ${vehicle.model} (${vehicle.plate}).\n\n${vehicle.issue}.`}\n\nÀ bientôt,\nL’équipe de ${state.settings.name}`}
          />
        </Field>
      </Form>
    </Modal>
  );
}
