'use client';
import { useEffect, useState } from 'react';
import { normalizeAccountPreferences } from '@/lib/account-preferences';
import { useGarage } from './provider';
import { Field, Form } from './ui';

export function AccountPreferencesPanel() {
  const { account, garages, request, refresh, notify, can, training } = useGarage();
  const [preferences, setPreferences] = useState(() =>
    normalizeAccountPreferences(account?.preferences),
  );
  useEffect(
    () => setPreferences(normalizeAccountPreferences(account?.preferences)),
    [account?.preferences],
  );
  const notificationLabels = {
    assignments: 'Travaux qui me sont attribués',
    blockages: 'Blocages dont je suis responsable',
    invitations: 'Invitations à rejoindre un garage',
    billing: 'Problèmes d’abonnement des garages dont je suis propriétaire',
  };
  return (
    <section className="data-panel settings-card">
      <h3>Mes préférences</h3>
      <Form
        label="Enregistrer mes préférences"
        onSubmit={async () => {
          if (training) return;
          await request('account/preferences', preferences);
          await refresh();
          notify('Préférences enregistrées.');
        }}
      >
        <Field
          label="Thème de l’interface"
          hint="Ce choix est personnel et vous suit dans tous vos garages après enregistrement."
        >
          <select
            value={preferences.theme}
            onChange={(e) =>
              setPreferences({ ...preferences, theme: e.target.value as typeof preferences.theme })
            }
          >
            <option value="light">Clair</option>
            <option value="dark">Sombre</option>
            <option value="system">Selon mon appareil</option>
          </select>
        </Field>
        <Field
          label="Écran à ouvrir à la connexion"
          hint="Si cet écran est inaccessible dans un garage, un écran autorisé sera ouvert."
        >
          <select
            value={preferences.initialPage}
            onChange={(e) =>
              setPreferences({
                ...preferences,
                initialPage: e.target.value as typeof preferences.initialPage,
              })
            }
          >
            <option value="garage" disabled={!can('garage.view')}>
              Mon garage
            </option>
            <option value="tasks" disabled={!can('garage.view')}>
              Mon travail
            </option>
            <option value="planning" disabled={!can('planning.view')}>
              Planning
            </option>
          </select>
        </Field>
        <Field
          label="Garage par défaut"
          hint="Sans préférence, le premier garage accessible est ouvert."
        >
          <select
            value={preferences.defaultGarageId ?? ''}
            onChange={(e) =>
              setPreferences({ ...preferences, defaultGarageId: e.target.value || undefined })
            }
          >
            <option value="">Aucun garage imposé</option>
            {garages.map((garage) => (
              <option key={garage.id} value={garage.id}>
                {garage.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Qualité du garage 3D">
          <select
            value={preferences.graphicsQuality}
            onChange={(e) =>
              setPreferences({
                ...preferences,
                graphicsQuality: e.target.value as typeof preferences.graphicsQuality,
              })
            }
          >
            <option value="auto">Automatique</option>
            <option value="low">Économique — téléphone ou ordinateur moins puissant</option>
            <option value="high">Élevée</option>
          </select>
        </Field>
        <label className="permission-row">
          <input
            type="checkbox"
            checked={preferences.reducedMotion}
            onChange={(e) => setPreferences({ ...preferences, reducedMotion: e.target.checked })}
          />
          <span>Réduire les animations</span>
        </label>
        <h4>Notifications dans CaRM</h4>
        <p>
          Choisissez les informations affichées dans votre centre de notifications. Les mails aux
          clients restent validés manuellement.
        </p>
        {Object.entries(notificationLabels).map(([key, label]) => (
          <label className="permission-row" key={key}>
            <input
              type="checkbox"
              checked={preferences.notifications[key as keyof typeof preferences.notifications]}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  notifications: { ...preferences.notifications, [key]: e.target.checked },
                })
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </Form>
    </section>
  );
}
