'use client';
import { useState } from 'react';
import { useGarage } from './provider';
import { AccountProfilePanel } from './account-profile';
import { AccountSecurityPanel } from './account-security';
import { AccountPreferencesPanel } from './account-preferences';
import { Badge, Field, Form, value } from './ui';
import { GoogleSignIn } from './google-sign-in';
import { AccountBilling } from './billing';
import './account.css';

export function AccountScreen() {
  const { account, request, refresh, notify, training } = useGarage();
  const [password, setPassword] = useState('');
  if (training || !account)
    return (
      <section className="data-panel settings-card">
        <h3>Mon compte</h3>
        <p>
          Les paramètres personnels sont accessibles depuis votre compte connecté, en dehors de la
          visite guidée.
        </p>
      </section>
    );
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Votre espace personnel</h2>
          <p>
            Ces réglages vous suivent dans tous vos garages, même lorsqu’un garage est en lecture
            seule.
          </p>
        </div>
      </div>
      <AccountBilling />
      <div className="settings-grid account-grid">
        <AccountProfilePanel />
        <AccountPreferencesPanel />
        <AccountSecurityPanel />
        <section className="data-panel settings-card">
          <h3>Connexion au compte</h3>
          {account.hasPassword ? (
            <Form
              label="Changer le mot de passe"
              onSubmit={async (f) => {
                await request('password', {
                  current: value(f, 'current'),
                  password: value(f, 'password'),
                });
                notify('Mot de passe modifié.');
                await refresh();
              }}
            >
              <Field label="Mot de passe actuel">
                <input name="current" type="password" autoComplete="current-password" required />
              </Field>
              <Field label="Nouveau mot de passe">
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </Field>
            </Form>
          ) : (
            <p>Vous vous connectez avec Google. Aucun mot de passe Caragem n’est enregistré.</p>
          )}
          <div className="google-account-settings">
            <h3>Connexion Google</h3>
            {account.googleLinked ? (
              <Badge tone="green">Google associé à votre compte</Badge>
            ) : (
              <>
                <p>Associez le compte Google correspondant à {account.email}.</p>
                <Field label="Confirmer votre mot de passe Caragem">
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <GoogleSignIn link password={password} />
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
