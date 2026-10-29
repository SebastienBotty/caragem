'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { z } from 'zod';
import { AppShell } from './app-shell';
import { GarageContext, type request as realRequest } from './provider';
import { Button } from './ui';
import { uid, type Action, type GarageState } from '@/lib/domain';
import { photoUploadSchema } from '@/lib/vehicle-photos';
import {
  applyTrainingAction,
  createTraining,
  matchesTrainingStep,
  type TrainingEvent,
} from '@/lib/training';

const invitationSchema = z.object({
  email: z.email(),
  role: z.enum(['mechanic', 'reception']),
  customRoleId: z.string().optional(),
});

export function TrainingTour({ page, close }: { page: string; close: () => void }) {
  const [exercise] = useState(() => createTraining(page));
  const [state, setState] = useState(exercise.state);
  const currentState = useRef(state);
  const [index, setIndex] = useState(0);
  const progress = useRef(0);
  const photoImages = useRef(new Map<string, string>());
  const [message, setMessage] = useState('');
  const root = useRef<HTMLDialogElement>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const invitation = useRef<{
    id: string;
    email: string;
    role: 'mechanic' | 'reception';
    customRoleId?: string;
    expires: number;
  } | null>(null);
  const step = exercise.steps[index];
  function update(next: GarageState) {
    currentState.current = next;
    setState(next);
  }
  function record(event: TrainingEvent) {
    const current = exercise.steps[progress.current];
    if (current && matchesTrainingStep(current, event)) {
      progress.current++;
      setIndex(progress.current);
      setMessage('');
    }
  }
  const act = async (action: Action) => {
    const next = applyTrainingAction(currentState.current, action);
    update(next);
    record(action);
    return next;
  };
  const request: typeof realRequest = async <T,>(path: string, body?: unknown): Promise<T> => {
    if (path.startsWith('vehicle-photos/')) {
      const image = photoImages.current.get(path.slice('vehicle-photos/'.length));
      if (!image) throw new Error('Photo fictive introuvable.');
      return { image } as T;
    }
    if (path === 'invitations')
      return { invitations: invitation.current ? [invitation.current] : [] } as T;
    if (path === 'invite') {
      const input = invitationSchema.parse(body);
      if (
        input.customRoleId &&
        !currentState.current.settings.customRoles?.some((r) => r.id === input.customRoleId)
      )
        throw new Error('Rôle fictif introuvable.');
      invitation.current = { ...input, id: uid(), expires: Date.now() + 7 * 86400000 };
      record({ type: 'trainingInvite' });
      return { url: 'https://formation.invalid/invitation-fictive' } as T;
    }
    if (path === 'revoke-invitation') {
      invitation.current = null;
      return {} as T;
    }
    // No fallback to the real transport: all account and network operations stay blocked.
    throw new Error('Cette opération n’est pas disponible dans l’entraînement.');
  };
  const api = async (path: string, body: unknown) => {
    if (path === 'vehicle-photos' || path === 'vehicle-photos/delete') {
      const next = structuredClone(currentState.current);
      if (path === 'vehicle-photos') {
        const input = photoUploadSchema.parse(body);
        const vehicle = next.vehicles.find((vehicle) => vehicle.id === input.vehicleId);
        if (!vehicle || vehicle.stage === 'returned' || (vehicle.photos?.length ?? 0) >= 30)
          throw new Error('Ajout de photo indisponible.');
        const photo = {
          id: uid(),
          category: input.category,
          caption: input.caption,
          finding: input.finding,
          createdAt: new Date().toISOString(),
          author: next.users[0].name,
          bytes: Math.ceil(input.image.length * 0.75),
        };
        (vehicle.photos ??= []).push(photo);
        photoImages.current.set(photo.id, input.image);
      } else {
        const { id } = z.object({ id: z.string() }).parse(body);
        for (const vehicle of next.vehicles)
          vehicle.photos = vehicle.photos?.filter((photo) => photo.id !== id);
        photoImages.current.delete(id);
      }
      next.revision++;
      update(next);
      return;
    }
    if (path !== 'send-mail') throw new Error('Opération indisponible dans l’entraînement.');
    const { id } = z.object({ id: z.string() }).parse(body);
    const next = structuredClone(currentState.current);
    const mail = next.mails.find((m) => m.id === id);
    if (!mail || mail.status !== 'draft') throw new Error('Brouillon fictif introuvable.');
    mail.status = 'sent';
    mail.sentAt = new Date().toISOString();
    mail.sentBy = next.users[0].name;
    next.revision++;
    update(next);
    record({ type: 'trainingSend' });
  };
  function join() {
    const pending = invitation.current;
    if (!pending) return setMessage('Créez d’abord une invitation fictive.');
    const next = structuredClone(currentState.current);
    next.users.push({
      id: uid(),
      name: 'Nouveau collègue',
      role:
        next.settings.customRoles?.find((role) => role.id === pending.customRoleId)?.baseRole ??
        pending.role,
      customRoleId: pending.customRoleId,
      color: '#8b78b7',
    });
    next.revision++;
    invitation.current = null;
    update(next);
    record({ type: 'trainingJoin' });
  }
  useEffect(() => {
    const element = root.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    let highlighted: HTMLElement | undefined;
    let permissionRows: HTMLElement[] = [];
    const sync = () => {
      const container = root.current;
      if (!container) return;
      const dialogs = Array.from(container.querySelectorAll<HTMLDialogElement>('dialog[open]'));
      const top = dialogs.at(-1) ?? container;
      setPortal((old) => (old === top ? old : top));
      const editor = step?.permissions
        ? top.querySelector(`[data-permission-editor="${step.type}"]`)
        : null;
      const rows = (step?.permissions ?? []).flatMap((permission) =>
        Array.from(
          editor?.querySelectorAll<HTMLElement>(`[data-permission="${permission}"]`) ?? [],
        ),
      );
      for (const row of permissionRows)
        if (!rows.includes(row)) row.classList.remove('training-permission-target');
      for (const row of rows)
        if (!row.classList.contains('training-permission-target'))
          row.classList.add('training-permission-target');
      permissionRows = rows;
      const nextPermission = rows.find((row) => {
        const input = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
        const select = row.querySelector<HTMLSelectElement>('select');
        return input ? !input.checked : select?.value === 'inherit';
      });
      const target =
        nextPermission ??
        step?.target
          .split(',')
          .map((selector) => top.querySelector<HTMLElement>(selector.trim()))
          .find((element) => {
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            return (
              rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < window.innerWidth
            );
          }) ??
        (step?.target.includes('data-tour-nav')
          ? top.querySelector<HTMLElement>('[aria-label="Ouvrir le menu"]')
          : null) ??
        top.querySelector<HTMLElement>('form') ??
        undefined;
      if (target !== highlighted) {
        highlighted?.classList.remove('training-target');
        target?.classList.add('training-target');
        highlighted = target;
        if (nextPermission) nextPermission.scrollIntoView({ block: 'center', behavior: 'instant' });
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    root.current?.addEventListener('change', sync, true);
    if (root.current)
      observer.observe(root.current, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open', 'class'],
      });
    return () => {
      observer.disconnect();
      root.current?.removeEventListener('change', sync, true);
      highlighted?.classList.remove('training-target');
      permissionRows.forEach((row) => row.classList.remove('training-permission-target'));
    };
  }, [step]);
  return (
    <dialog
      ref={root}
      className="training-shell"
      aria-label={`Entraînement : ${exercise.title}`}
      onCancel={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className="training-banner">
        ENTRAÎNEMENT · Données fictives · Vous jouez un patron fictif · Rien n’est enregistré dans
        votre garage
      </div>
      <GarageContext.Provider
        value={{
          state,
          user: state.users[0],
          training: true,
          request,
          onboardingSeen: true,
          connected: false,
          smtp: true,
          account: null,
          garages: [],
          can: () => true,
          act,
          api,
          notify: setMessage,
          refresh: async () => {},
        }}
      >
        <AppShell initialPage={exercise.initialPage} />
      </GarageContext.Provider>
      {portal &&
        createPortal(
          <aside
            className="training-coach"
            aria-label="Guide de l’entraînement"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="eyebrow">
              ENTRAÎNEMENT · {Math.min(index + 1, exercise.steps.length)}/{exercise.steps.length}
            </span>
            <h2 aria-live="polite">{step?.title ?? 'Exercice terminé !'}</h2>
            <p>
              {step?.text ??
                'Vous avez réalisé le scénario dans les vrais écrans avec des données fictives. En fermant, vous retrouverez votre garage tel que vous l’avez laissé.'}
            </p>
            <progress
              max={exercise.steps.length}
              value={index}
              aria-label="Progression de l’exercice"
            />
            {message && <p role="status">{message}</p>}
            {step?.type === 'trainingJoin' && (
              <Button className="primary" onClick={join}>
                Simuler l’acceptation
              </Button>
            )}
            <Button onClick={close}>
              {step ? 'Quitter l’entraînement' : 'Revenir à mon garage'}
            </Button>
          </aside>,
          portal,
        )}
    </dialog>
  );
}
