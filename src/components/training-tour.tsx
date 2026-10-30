'use client';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { AppShell } from './app-shell';
import { GarageContext, type request as realRequest } from './provider';
import { Button, Modal } from './ui';
import { VehicleDrawer } from './vehicle-drawer';
import { DocumentDetail } from './documents';
import { createTrainingDemonstration } from '@/lib/training-demonstration';
import { AssignRoleDialog, CustomRoleDialog, UserPermissionsDialog } from './permissions-editor';

export function TrainingTour({ page, close }: { page: string; close: () => void }) {
  const [tour] = useState(() => createTrainingDemonstration(page));
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const root = useRef<HTMLDialogElement>(null);
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const scene = tour.scenes[Math.min(index, tour.scenes.length - 1)];
  const finished = index === tour.scenes.length;
  const { state, step } = scene;
  const unavailable = async (): Promise<never> => {
    throw new Error('Cette visite est une démonstration en lecture seule.');
  };
  const request: typeof realRequest = async <T,>(path: string): Promise<T> => {
    if (path === 'invitations')
      return { invitations: scene.invitation ? [scene.invitation] : [] } as T;
    return unavailable();
  };
  function readOnly(event: SyntheticEvent) {
    if (!(event.target as HTMLElement).closest('.training-coach')) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  useEffect(() => {
    const element = root.current;
    element?.showModal();
    setReady(true);
    return () => element?.close();
  }, []);
  useEffect(() => {
    let highlighted: HTMLElement | null = null;
    const sync = () => {
      const container = root.current;
      if (!container) return;
      const top =
        Array.from(container.querySelectorAll<HTMLDialogElement>('dialog[open]')).at(-1) ??
        container;
      setPortal((old) => (old === top ? old : top));
      container
        .querySelectorAll<
          HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement
        >('input, button, select, textarea')
        .forEach((control) => {
          if (!control.closest('.training-coach')) control.disabled = true;
        });
      const permission = step.permissions
        ?.map((id) => top.querySelector<HTMLElement>(`[data-permission="${id}"]`))
        .find(Boolean);
      const target = finished
        ? null
        : (permission ??
          step.target
            .split(',')
            .map((selector) => top.querySelector<HTMLElement>(selector.trim()))
            .find((element) => element && element.getBoundingClientRect().width > 0) ??
          top.querySelector<HTMLElement>(
            '.drawer-content, .document-preview, [data-tour="content"]',
          ));
      if (highlighted !== target) {
        highlighted?.classList.remove('training-target');
        target?.classList.add('training-target');
        highlighted = target;
        target?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    if (root.current)
      observer.observe(root.current, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['open'],
      });
    return () => {
      observer.disconnect();
      highlighted?.classList.remove('training-target');
    };
  }, [index, step, finished]);
  useEffect(() => {
    portal
      ?.querySelector<HTMLButtonElement>('.training-coach button:not(:disabled)')
      ?.focus({ preventScroll: true });
  }, [portal, index]);
  const coach = (
    <aside className="training-coach" aria-label="Guide de la démonstration">
      <span className="eyebrow">
        VISITE GUIDÉE · {Math.min(index + 1, tour.scenes.length)}/{tour.scenes.length}
      </span>
      <h2 aria-live="polite">{finished ? 'Visite terminée' : step.title}</h2>
      <p>
        {finished
          ? 'Vous avez découvert le parcours avec des données fictives. Votre garage est resté inchangé.'
          : step.text}
      </p>
      <progress
        max={tour.scenes.length}
        value={index + (finished ? 0 : 1)}
        aria-label="Progression de la visite"
      />
      <Button disabled={index === 0} onClick={() => setIndex(index - 1)}>
        Précédent
      </Button>
      {!finished && (
        <Button className="primary" onClick={() => setIndex(index + 1)}>
          {index === tour.scenes.length - 1 ? 'Terminer la visite' : 'Suivant'}
        </Button>
      )}
      <Button onClick={close}>{finished ? 'Revenir à mon garage' : 'Quitter la visite'}</Button>
    </aside>
  );
  return (
    <dialog
      ref={root}
      className="training-shell"
      aria-label={`Visite guidée : ${tour.title}`}
      onClickCapture={readOnly}
      onSubmitCapture={readOnly}
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        } else if (
          !(event.target as HTMLElement).closest('.training-coach') &&
          !['Tab', 'Shift'].includes(event.key)
        )
          readOnly(event);
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="training-banner">
        VISITE GUIDÉE · Regardez les étapes, aucune saisie nécessaire · Données fictives · Votre
        garage reste inchangé
      </div>
      <GarageContext.Provider
        value={{
          state,
          user: state.users[0],
          training: true,
          request,
          onboardingSeen: true,
          connected: false,
          smtp: false,
          account: null,
          garages: [],
          can: () => true,
          act: unavailable,
          api: unavailable,
          notify: () => {},
          refresh: async () => {},
        }}
      >
        {ready && <AppShell key={index} initialPage={scene.page} />}
        {ready && scene.vehicleId && (
          <VehicleDrawer
            key={`vehicle-${index}`}
            id={scene.vehicleId}
            initialTab={scene.tab}
            close={() => {}}
          />
        )}
        {ready && scene.documentId && (
          <DocumentDetail
            key={`document-${index}`}
            document={state.documents.find((d) => d.id === scene.documentId)!}
            close={() => {}}
          />
        )}
        {ready && step.type === 'customRole' && (
          <CustomRoleDialog
            key={index}
            role={state.settings.customRoles!.at(-1)!}
            close={() => {}}
          />
        )}
        {ready && step.type === 'assignRole' && (
          <AssignRoleDialog key={index} member={state.users.at(-1)!} close={() => {}} />
        )}
        {ready && step.type === 'userPermissions' && (
          <UserPermissionsDialog key={index} member={state.users.at(-1)!} close={() => {}} />
        )}
        {ready && scene.page === 'messages' && (
          <Modal
            key={index}
            title={state.mails[0].subject}
            subtitle={state.mails[0].status === 'sent' ? 'Envoi simulé' : 'Brouillon fictif'}
            close={() => {}}
          >
            <p>À : {state.mails[0].to}</p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{state.mails[0].body}</p>
          </Modal>
        )}
      </GarageContext.Provider>
      {portal ? createPortal(coach, portal) : coach}
    </dialog>
  );
}
