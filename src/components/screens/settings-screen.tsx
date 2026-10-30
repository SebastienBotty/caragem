'use client';
import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { stages } from '@/lib/domain';
import { useGarage } from '../provider';
import { Badge, Button } from '../ui';
import { Configure } from '../forms';

import { RolePermissionsDialog } from '../permissions-editor';
import { CsvTransfer } from '../csv-transfer';
import { BillingCard } from '../billing';

export function SettingsScreen() {
  const { state, user, can, training } = useGarage();
  const [roles, setRoles] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [config, setConfig] = useState(false);

  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Votre garage, à votre façon.</h2>
          <p>Configuration de l’espace et sécurité du compte.</p>
        </div>
      </div>
      <div className="settings-grid">
        {user.role === 'owner' && !state.demo && !training && <BillingCard />}
        {user.role === 'owner' && !training && (
          <section className="data-panel settings-card">
            <h3>Importer / exporter les données</h3>
            <p>
              Clients, véhicules et visites, stock, réservations, rendez-vous, commandes, devis et
              factures. Fichiers CSV et Excel, modèles et exemples, avec un aperçu avant
              confirmation.
            </p>
            <Button onClick={() => setTransfer(true)}>Importer / exporter</Button>
          </section>
        )}
        <section className="data-panel settings-card">
          <span className="settings-icon">
            <Settings2 size={24} />
          </span>
          <h3>{state.settings.name}</h3>
          <p>{state.settings.address || 'Adresse à compléter'}</p>
          <Badge tone="blue">{state.settings.country === 'FR' ? 'France' : 'Belgique'}</Badge>
          <div className="settings-modules">
            {stages.map((s) => (
              <span key={s.id}>
                <i style={{ background: s.color }} />
                {s.label}
                <b>{state.settings.modules[s.id]} module(s)</b>
              </span>
            ))}
          </div>
          {can('garage.configure') && (
            <Button onClick={() => setConfig(true)}>Modifier le garage</Button>
          )}
          {user.role === 'owner' && (
            <Button onClick={() => setRoles(true)}>Permissions des rôles</Button>
          )}
        </section>
      </div>
      {config && can('garage.configure') && <Configure close={() => setConfig(false)} />}
      {roles && <RolePermissionsDialog close={() => setRoles(false)} />}
      {transfer && user.role === 'owner' && !training && (
        <CsvTransfer close={() => setTransfer(false)} />
      )}
    </>
  );
}
