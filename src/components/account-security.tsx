'use client';
import { useEffect, useState } from 'react';
import { useGarage } from './provider';
import { Badge, Button, Field, Form, value } from './ui';
import { GoogleSignIn } from './google-sign-in';

type SecurityInfo = {
  enabled: boolean;
  configured: boolean;
  recoveryCount: number;
  sessions: {
    id: string;
    current: boolean;
    createdAt: number;
    lastSeen: number;
    expires: number;
    userAgent: string;
    garage: string;
  }[];
};
const date = (at: number) => new Date(at).toLocaleString('fr-FR');
function device(agent: string) {
  const platform = /Android/.test(agent)
    ? 'Android'
    : /iPhone|iPad/.test(agent)
      ? 'iPhone / iPad'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Macintosh/.test(agent)
          ? 'Mac'
          : /Linux/.test(agent)
            ? 'Linux'
            : 'Appareil non identifié';
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : '';
  return [browser, platform].filter(Boolean).join(' · ');
}
export function AccountSecurityPanel() {
  const { request, account, refresh, notify } = useGarage();
  const [info, setInfo] = useState<SecurityInfo>();
  const [setup, setSetup] = useState<{ secret: string; uri: string }>();
  const [recovery, setRecovery] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => setInfo(await request<SecurityInfo>('account/security'));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [request, account?.email]);
  const revoke = async (body: { id: string } | { others: true }) => {
    setBusy(true);
    setError('');
    try {
      const result = await request<{ loggedOut: boolean }>(
        'account/security/sessions/revoke',
        body,
      );
      if (result.loggedOut) await refresh();
      else {
        await load();
        notify('Sessions déconnectées.');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="data-panel settings-card">
        <h3>Double authentification</h3>
        <p>
          Ajoutez le code d’une application d’authentification à votre connexion, y compris avec
          Google.
        </p>
        {info && (
          <Badge tone={info.enabled ? 'green' : 'orange'}>
            {info.enabled ? 'Activée' : 'Désactivée'}
          </Badge>
        )}
        {info && !info.configured && (
          <p>La plateforme doit configurer sa clé de sécurité pour permettre l’activation.</p>
        )}
        {info && !info.enabled && !setup && (
          <Form
            label="Configurer la double authentification"
            hideSubmit={!info.configured}
            onSubmit={async (f) => {
              const result = await request<{ secret: string; uri: string }>(
                'account/security/2fa/setup',
                { password: value(f, 'password') || undefined },
              );
              setRecovery([]);
              setSetup(result);
            }}
          >
            {account?.hasPassword ? (
              <Field label="Mot de passe actuel">
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                />
              </Field>
            ) : (
              <>
                <p>
                  Reconnectez-vous avec Google si votre dernière authentification remonte à plus de
                  10 minutes.
                </p>
                <GoogleSignIn />
              </>
            )}
          </Form>
        )}
        {setup && (
          <>
            <p>
              Dans votre application d’authentification, ajoutez un compte avec une clé de
              configuration. Choisissez un code temporel, SHA-1, 6 chiffres et 30 secondes.
            </p>
            <Field label="Nom du compte">
              <input readOnly value={`CaRM : ${account?.email}`} />
            </Field>
            <Field label="Clé à saisir dans l’application">
              <input
                readOnly
                value={setup.secret}
                aria-label="Clé de configuration TOTP"
                autoComplete="off"
              />
            </Field>
            <Form
              label="Vérifier et activer"
              onSubmit={async (f) => {
                const result = await request<{ recoveryCodes: string[] }>(
                  'account/security/2fa/enable',
                  { code: value(f, 'code') },
                );
                setRecovery(result.recoveryCodes);
                setSetup(undefined);
                await load();
                await refresh();
                notify('Double authentification activée. Les autres sessions sont déconnectées.');
              }}
            >
              <Field label="Code à 6 chiffres">
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                />
              </Field>
            </Form>
            <Button onClick={() => setSetup(undefined)}>Annuler la configuration</Button>
          </>
        )}
        {recovery.length > 0 && (
          <div role="status">
            <h4>Conservez vos codes de secours</h4>
            <p>
              Ils ne seront affichés qu’ici. Chaque code permet une seule connexion si vous perdez
              votre application.
            </p>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {recovery.join('\n')}
            </pre>
            <Button
              onClick={() => {
                const link = document.createElement('a');
                const url = URL.createObjectURL(
                  new Blob(
                    [`Codes de secours CaRM — ${account?.email}\n\n${recovery.join('\n')}\n`],
                    { type: 'text/plain' },
                  ),
                );
                link.href = url;
                link.download = 'carm-codes-de-secours.txt';
                link.click();
                URL.revokeObjectURL(url);
              }}
            >
              Télécharger les codes
            </Button>
            <Button onClick={() => setRecovery([])}>J’ai conservé mes codes</Button>
          </div>
        )}
        {info?.enabled && (
          <>
            <p>
              {info.recoveryCount} code(s) de secours disponible(s). Les codes de l’application sont
              à usage unique ; attendez le suivant après une validation.
            </p>
            <Form
              label="Désactiver la double authentification"
              onSubmit={async (f) => {
                await request('account/security/2fa/disable', {
                  password: value(f, 'password') || undefined,
                  code: value(f, 'code'),
                });
                setRecovery([]);
                await load();
                await refresh();
                notify('Double authentification désactivée.');
              }}
            >
              {account?.hasPassword ? (
                <Field label="Mot de passe actuel">
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={128}
                  />
                </Field>
              ) : (
                <GoogleSignIn />
              )}
              <Field label="Code de l’application ou code de secours">
                <input
                  name="code"
                  autoComplete="one-time-code"
                  required
                  minLength={6}
                  maxLength={80}
                />
              </Field>
            </Form>
          </>
        )}
      </section>
      <section className="data-panel settings-card">
        <h3>Appareils et sessions connectés</h3>
        <p>
          Déconnectez les appareils que vous n’utilisez plus, notamment sur un ordinateur partagé.
        </p>
        {info &&
          info.sessions.map((s) => (
            <div
              key={s.id}
              className="session-item"
              style={{ padding: '14px 0', borderBottom: '1px solid #e8ecf4' }}
            >
              <strong>{device(s.userAgent)}</strong>{' '}
              {s.current && <Badge tone="blue">Cette session</Badge>}
              <p>
                {s.garage}
                <br />
                Connexion : {date(s.createdAt)}
                <br />
                Dernière activité : {date(s.lastSeen)}
              </p>
              <Button busy={busy} onClick={() => void revoke({ id: s.id })}>
                {s.current ? 'Me déconnecter ici' : 'Déconnecter cet appareil'}
              </Button>
            </div>
          ))}
        {info && info.sessions.some((s) => !s.current) && (
          <Button busy={busy} onClick={() => void revoke({ others: true })}>
            Déconnecter toutes les autres sessions
          </Button>
        )}
      </section>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
