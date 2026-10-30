'use client';
import { useCallback, useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import type { AccountNotification } from '@/lib/account-preferences';
import { useGarage } from './provider';
import { Button, Empty, Modal } from './ui';

export function AccountNotifications({
  onNavigate,
}: {
  onNavigate?: (page: string, vehicleId?: string) => void;
}) {
  const { account, state, request, training } = useGarage();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AccountNotification[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!account || training) return;
    try {
      const result = await request<{ notifications: AccountNotification[] }>(
        'account/notifications',
      );
      setItems(result.notifications);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [account, request, training]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [load, state.revision]);
  if (!account || training) return null;
  return (
    <>
      <button
        className="notification-button icon-button"
        title="Mes notifications"
        aria-label={`Mes notifications : ${items.length} information(s)`}
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <Bell size={19} />
        {items.length > 0 && <i />}
      </button>
      {open && (
        <Modal
          title="Mes notifications"
          subtitle="Travaux et informations qui vous concernent. Cette liste montre la situation actuelle, pas un historique de lecture."
          close={() => setOpen(false)}
        >
          <div className="form">
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {!error && items.length === 0 && (
              <Empty
                title="Vous êtes à jour"
                text="Aucune information à afficher avec vos préférences actuelles."
              />
            )}
            {items.map((item) => (
              <section key={item.id} className="data-panel settings-card">
                <small>{item.garageName}</small>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                {item.page && onNavigate && (
                  <Button
                    onClick={() => {
                      setOpen(false);
                      onNavigate(item.page!, item.vehicleId);
                    }}
                  >
                    Ouvrir
                  </Button>
                )}
              </section>
            ))}
            <Button onClick={() => void load()}>Actualiser</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
