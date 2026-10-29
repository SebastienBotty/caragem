'use client';
import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { stages } from '@/lib/domain';
import { useGarage } from '../provider';
import { Badge, Button, Field, Form, value } from '../ui';
import { Configure } from '../forms';
import { GoogleSignIn } from '../google-sign-in';
import { RolePermissionsDialog } from '../permissions-editor';

export function SettingsScreen() {
  const { state, user, account, refresh, notify, can, request, training } = useGarage();
  const [roles, setRoles] = useState(false);
  const [config, setConfig] = useState(false);
  const [googlePassword, setGooglePassword] = useState('');
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Votre garage, à votre façon.</h2>
          <p>Configuration de l’espace et sécurité du compte.</p>
        </div>
      </div>
      <div className="settings-grid">
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
        <section className="data-panel settings-card">
          <h3>Sécurité du compte</h3>
          {state.demo ? (
            <>
              <p>
                Vous explorez un espace de démonstration isolé. Créez votre garage pour commencer
                avec vos propres données.
              </p>
              <Button
                disabled={training}
                onClick={async () => {
                  await request('logout', {});
                  await refresh();
                }}
              >
                Quitter la démonstration
              </Button>
            </>
          ) : !account?.hasPassword ? (
            <p>
              Vous vous connectez avec votre compte Google. Aucun mot de passe CaRM n’est
              enregistré.
            </p>
          ) : (
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
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                />
              </Field>
            </Form>
          )}
          {!state.demo && (
            <div className="google-account-settings">
              <h3>Connexion Google</h3>
              {account?.googleLinked ? (
                <Badge tone="green">Google associé à votre compte</Badge>
              ) : (
                <>
                  <p>
                    Associez le compte Google correspondant à {account?.email} pour retrouver les
                    mêmes garages.
                  </p>
                  <Field label="Confirmer votre mot de passe CaRM">
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={googlePassword}
                      onChange={(e) => setGooglePassword(e.target.value)}
                    />
                  </Field>
                  <GoogleSignIn link password={googlePassword} />
                </>
              )}
            </div>
          )}
        </section>
      </div>
      {config && can('garage.configure') && <Configure close={() => setConfig(false)} />}
      {roles && <RolePermissionsDialog close={() => setRoles(false)} />}
    </>
  );
}
