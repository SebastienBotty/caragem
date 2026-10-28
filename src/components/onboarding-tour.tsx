'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Compass, X } from 'lucide-react';
import { onboardingRoute } from '@/lib/onboarding';
import { request, useGarage } from './provider';
import { Button } from './ui';

export function OnboardingTour({
  enabled,
  launch,
  page,
  navigate,
  menuOpen,
  showMenu,
}: {
  enabled: boolean;
  launch: number;
  page: string;
  navigate: (page: string) => void;
  menuOpen: boolean;
  showMenu: (open: boolean) => void;
}) {
  const { state, user, onboardingSeen, notify } = useGarage();
  const [seen, setSeen] = useState(onboardingSeen);
  const [step, setStep] = useState<number | null>(null);
  const [spotlight, setSpotlight] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const handledLaunch = useRef(launch);
  const originPage = useRef(page);
  const titleId = useId();
  const steps = onboardingRoute(state, user, originPage.current);
  const index = step === null ? -1 : Math.min(step, steps.length - 1);
  const current = index >= 0 ? steps[index] : undefined;
  const open = step !== null;

  useEffect(() => {
    if (!enabled) return;
    if (launch !== handledLaunch.current || (!seen && step === null)) {
      handledLaunch.current = launch;
      originPage.current = page;
      setStep(-1);
    }
  }, [enabled, launch, page, seen, step]);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [open]);
  useEffect(() => {
    if (current?.navigation) showMenu(true);
    else if (current) navigate(current.page);
  }, [current?.id, navigate, showMenu]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSpotlight(null);
    if (
      !current ||
      (!current.navigation && current.page !== page) ||
      (current.navigation && !menuOpen)
    )
      return;
    const target =
      document.querySelector<HTMLElement>(current.target) ??
      document.querySelector<HTMLElement>('[data-tour="content"]');
    if (!target) return;
    target.scrollIntoView({
      block: current.id === 'garage' && window.innerWidth <= 600 ? 'start' : 'nearest',
      behavior: 'instant',
    });
    const measure = () => {
      const rect = target.getBoundingClientRect();
      if (rect.right <= 0 || rect.left >= window.innerWidth) return setSpotlight(null);
      const left = Math.max(8, rect.left - 6),
        top = Math.max(8, rect.top - 6);
      const right = Math.min(window.innerWidth - 8, rect.right + 6);
      const bottom = Math.min(window.innerHeight - 8, rect.bottom + 6);
      setSpotlight(
        right > left && bottom > top
          ? { left, top, width: right - left, height: bottom - top }
          : null,
      );
    };
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('transitionend', measure, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('transitionend', measure, true);
    };
  }, [current?.id, page, menuOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  async function dismiss() {
    setSeen(true);
    setStep(null);
    navigate(originPage.current);
    if (seen) return;
    try {
      await request('onboarding', {});
    } catch {
      notify(
        'Visite fermée. Votre préférence n’a pas pu être enregistrée ; elle pourra réapparaître à la prochaine connexion.',
      );
    }
  }
  function advance() {
    if (current?.navigation) navigate(current.page);
    setStep(index + 1);
  }
  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      className="onboarding-tour"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const buttons =
          event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        void dismiss();
      }}
    >
      {spotlight ? (
        <div className="tour-spotlight" style={spotlight} />
      ) : (
        <div className="tour-shade" />
      )}
      {current?.navigation && spotlight && (
        <button
          className="tour-nav-hit"
          style={spotlight}
          aria-label={`Cliquer sur ${current.navigation} dans le menu`}
          onClick={advance}
        />
      )}
      <section
        className={`tour-card ${current ? '' : 'tour-welcome'}`}
        style={
          current?.navigation && spotlight && spotlight.top > window.innerHeight / 2
            ? { top: 16, bottom: 'auto' }
            : undefined
        }
      >
        <div className="tour-heading">
          <span className="tour-icon">
            <Compass size={24} />
          </span>
          <button
            className="icon-button"
            aria-label="Fermer la visite guidée"
            onClick={() => void dismiss()}
          >
            <X size={18} />
          </button>
        </div>
        <div aria-live="polite" aria-atomic="true">
          <span className="eyebrow">
            {current
              ? `PRISE EN MAIN · ÉTAPE ${index + 1} SUR ${steps.length}`
              : 'BIENVENUE CHEZ CaRM'}
          </span>
          <h2 id={titleId}>{current?.title ?? 'Découvrez votre nouvel atelier.'}</h2>
          <p>
            {current?.text ??
              'Quelques étapes pour retrouver vos véhicules, suivre les interventions et travailler avec votre équipe. Vous pourrez relancer cette visite à tout moment depuis le menu.'}
          </p>
        </div>
        {current && (
          <progress aria-label="Progression de la visite" max={steps.length} value={index + 1} />
        )}
        <div className="tour-actions">
          {current ? (
            <Button onClick={() => setStep(index - 1)}>
              <ArrowLeft size={15} />
              Précédent
            </Button>
          ) : (
            <Button onClick={() => void dismiss()}>Plus tard</Button>
          )}
          <Button
            className="primary"
            onClick={() => (index === steps.length - 1 ? void dismiss() : advance())}
          >
            {!current
              ? 'Découvrir CaRM'
              : current.navigation
                ? `Ouvrir ${current.navigation}`
                : index === steps.length - 1
                  ? 'Terminer'
                  : 'Suivant'}
            <ArrowRight size={15} />
          </Button>
        </div>
        {current && (
          <button className="text-button tour-skip" onClick={() => void dismiss()}>
            Passer la visite
          </button>
        )}
      </section>
    </dialog>
  );
}
