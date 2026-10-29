'use client';
import { AlertTriangle } from 'lucide-react';
import { blockageKinds, type Vehicle } from '@/lib/domain';
import { useGarage } from './provider';
import { Button, Field, Form, Modal, formatDate, localDateInput, value } from './ui';

export function VehicleBlocker({
  vehicle,
  open,
  edit,
  close,
}: {
  vehicle: Vehicle;
  open: boolean;
  edit: () => void;
  close: () => void;
}) {
  const { state, can, act } = useGarage();
  const details = vehicle.blockerDetails;
  return (
    <>
      {vehicle.blocker && (
        <div className="structured-blocker">
          <div className="drawer-blocker">
            <AlertTriangle size={17} />
            <strong>{vehicle.blocker}</strong>
            {vehicle.stage !== 'returned' && can('vehicles.edit') && (
              <button onClick={edit}>Modifier</button>
            )}
          </div>
          {details && (
            <div className="blocker-detail">
              <span>
                {blockageKinds.find((kind) => kind.id === details.kind)?.label} · Depuis le{' '}
                {formatDate(details.openedAt)}
              </span>
              <span>
                Responsable :{' '}
                {state.users.find((user) => user.id === details.assigneeId)?.name ?? 'À attribuer'}
              </span>
              {details.expectedAt && (
                <span className={Date.parse(details.expectedAt) < Date.now() ? 'form-error' : ''}>
                  Échéance : {formatDate(details.expectedAt)}
                </span>
              )}
              {details.nextAction && <strong>Prochaine action : {details.nextAction}</strong>}
            </div>
          )}
        </div>
      )}
      {!!vehicle.blockerHistory?.length && (
        <details className="blocker-history">
          <summary>Blocages résolus ({vehicle.blockerHistory.length})</summary>
          {vehicle.blockerHistory.map((item, index) => (
            <p key={index}>
              <strong>{item.text}</strong>
              <br />
              {formatDate(item.openedAt)} → {formatDate(item.resolvedAt)} · {item.nextAction}
            </p>
          ))}
        </details>
      )}
      {open && can('vehicles.edit') && (
        <Modal title="Signaler un blocage" close={close}>
          <Form
            onSubmit={async (f) => {
              await act({
                type: 'blocker',
                id: vehicle.id,
                text: value(f, 'text'),
                kind: value(f, 'kind') as NonNullable<Vehicle['blockerDetails']>['kind'],
                assigneeId: value(f, 'assigneeId') || undefined,
                expectedAt: value(f, 'expectedAt')
                  ? new Date(value(f, 'expectedAt')).toISOString()
                  : undefined,
                nextAction: value(f, 'nextAction'),
              });
              close();
            }}
          >
            <Field label="Motif">
              <select name="kind" defaultValue={details?.kind ?? 'other'}>
                {blockageKinds.map((kind) => (
                  <option value={kind.id} key={kind.id}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description du blocage">
              <input name="text" required maxLength={2000} defaultValue={vehicle.blocker} />
            </Field>
            <Field label="Responsable">
              <select name="assigneeId" defaultValue={details?.assigneeId ?? ''}>
                <option value="">À attribuer</option>
                {state.users.map((user) => (
                  <option value={user.id} key={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Échéance attendue">
              <input
                name="expectedAt"
                type="datetime-local"
                defaultValue={
                  details?.expectedAt ? localDateInput(new Date(details.expectedAt)) : ''
                }
              />
            </Field>
            <Field label="Prochaine action">
              <input
                name="nextAction"
                required
                maxLength={2000}
                defaultValue={details?.nextAction ?? ''}
                placeholder="Relancer le fournisseur, appeler le client…"
              />
            </Field>
          </Form>
          {vehicle.blocker && (
            <Form
              label="Lever le blocage"
              onSubmit={async () => {
                await act({ type: 'blocker', id: vehicle.id, text: '' });
                close();
              }}
            >
              <p className="muted">Le blocage résolu reste dans l’historique de cette visite.</p>
            </Form>
          )}
        </Modal>
      )}
    </>
  );
}
