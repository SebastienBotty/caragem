'use client';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X, LoaderCircle, ArrowUpRight, CarFront } from 'lucide-react';

export function Button({
  children,
  className = '',
  busy,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button className={`button ${className}`} {...props} disabled={busy || props.disabled}>
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Avatar({
  name,
  color = '#4263eb',
  small = false,
}: {
  name: string;
  color?: string;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${small ? 'small' : ''}`}
      style={{ background: color + '20', color }}
      title={name}
    >
      {name
        .split(' ')
        .map((n) => n[0])
        .slice(0, 2)
        .join('')}
    </span>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  close,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" onClick={close} aria-label="Fermer">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Form({
  children,
  onSubmit,
  label = 'Enregistrer',
  className = '',
  hideSubmit = false,
  onChange,
}: {
  children: ReactNode;
  onSubmit: (data: FormData) => Promise<void>;
  label?: string;
  className?: string;
  hideSubmit?: boolean;
  onChange?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSubmit(new FormData(e.currentTarget));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={`form ${className}`} onSubmit={submit} onChange={onChange}>
      {children}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!hideSubmit && (
        <div className="form-footer">
          <Button type="submit" className="primary" busy={busy}>
            {label}
            <ArrowUpRight size={16} />
          </Button>
        </div>
      )}
    </form>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <CarFront size={28} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export const value = (f: FormData, key: string) => String(f.get(key) ?? '');
export const number = (f: FormData, key: string) => Number(value(f, key));
export const cents = (f: FormData, key: string) => Math.round(number(f, key) * 100);
export const localDateInput = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};
export const formatDate = (s: string, time = true) =>
  new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(s));
