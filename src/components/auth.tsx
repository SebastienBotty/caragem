'use client';
import { useState } from 'react';
import { ArrowUpRight, Box, Check, Layers3, Radio, Wrench } from 'lucide-react';
import { Button, Field, Form, value } from './ui';
import { request } from './provider';

export function Auth({ done }: { done: () => Promise<void> }) {
  const invitation =
    typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('invitation') ?? '')
      : '';
  const email =
    typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('email') ?? '')
      : '';
  const [mode, setMode] = useState<'welcome' | 'login' | 'register'>('register');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <main className="auth-page">
      <div className="auth-story">
        <a className="brand" href="/">
          <span className="brand-mark">
            <Layers3 />
          </span>
          CaRM<span className="brand-dot">.</span>
        </a>
        <div className="auth-copy">
          <span className="eyebrow">LE QUOTIDIEN DU GARAGE, RÉINVENTÉ</span>
          <h1>
            Moins de tableaux.
            <br />
            Plus de <em>perspective.</em>
          </h1>
          <p>
            Votre atelier prend vie. Suivez chaque véhicule, coordonnez votre équipe et gardez une
            longueur d’avance.
          </p>
          <div className="auth-features">
            <span>
              <Box size={18} /> Un garage en 3D
            </span>
            <span>
              <Radio size={18} /> Une équipe connectée
            </span>
            <span>
              <Wrench size={18} /> Tout au même endroit
            </span>
          </div>
        </div>
        <div className="mini-workshop" aria-hidden="true">
          <div className="mini-floor">
            <div className="mini-bay b1">
              <i />
              <i />
              <span>ATELIER</span>
              <div className="mini-car c1" />
            </div>
            <div className="mini-bay b2">
              <i />
              <i />
              <div className="mini-car c2" />
            </div>
            <div className="mini-bay b3">
              <i />
              <i />
              <div className="mini-car c3" />
            </div>
            <div className="mini-road" />
            <div className="mini-park">
              <div className="mini-car c4" />
              <div className="mini-car c5" />
            </div>
          </div>
        </div>
        <footer>Conçu pour ceux qui font tourner l’atelier.</footer>
      </div>
      <div className="auth-panel">
        <div className="auth-card">
          <span className="badge blue">BIENVENUE CHEZ CaRM</span>
          <h2>
            {mode === 'welcome'
              ? 'Un nouveau regard\nsur votre garage.'
              : mode === 'login'
                ? 'Heureux de vous revoir.'
                : invitation
                  ? 'Rejoindre votre équipe.'
                  : 'Créez votre compte et votre garage.'}
          </h2>
          <p>
            {mode === 'welcome'
              ? 'Prenez les commandes d’un garage de démonstration. Aucun compte nécessaire.'
              : mode === 'login'
                ? 'Retrouvez votre garage et votre équipe.'
                : invitation
                  ? 'Rejoignez le garage avec votre adresse invitée, ou connectez-vous à votre compte existant.'
                  : 'Un compte personnel pour créer vos garages et rejoindre votre équipe.'}
          </p>
          {mode === 'welcome' ? (
            <>
              <Button
                className="primary large"
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await request('demo', {});
                    await done();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Explorer le garage de démonstration
                <ArrowUpRight size={18} />
              </Button>
              <div className="auth-or">
                <span />
                ou
                <span />
              </div>
              <Button className="large" onClick={() => setMode('register')}>
                Créer mon garage
              </Button>
              <p className="auth-switch">
                Déjà dans l’équipe ? <button onClick={() => setMode('login')}>Se connecter</button>
              </p>
              <div className="auth-reassurance">
                <Check size={15} /> Vos essais restent dans votre espace de démonstration.
              </div>
            </>
          ) : (
            <Form
              label={
                mode === 'login'
                  ? 'Se connecter'
                  : invitation
                    ? 'Rejoindre le garage'
                    : 'Créer mon compte et mon garage'
              }
              onSubmit={async (f) => {
                await request(mode, {
                  name: mode === 'register' ? value(f, 'name') : undefined,
                  garage: value(f, 'garage') || undefined,
                  email: value(f, 'email'),
                  password: value(f, 'password'),
                  invitation: invitation || undefined,
                });
                if (invitation) window.history.replaceState(null, '', '/');
                await done();
              }}
            >
              {mode === 'register' && (
                <>
                  <Field label="Votre nom">
                    <input name="name" required autoComplete="name" placeholder="Alex Martin" />
                  </Field>
                  {!invitation && (
                    <Field label="Nom du garage">
                      <input name="garage" required placeholder="Garage des Érables" />
                    </Field>
                  )}
                </>
              )}
              <Field label="Adresse mail">
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  defaultValue={email}
                  readOnly={Boolean(invitation && email)}
                  placeholder="vous@votre-garage.fr"
                />
              </Field>
              <Field
                label="Mot de passe"
                hint="12 caractères minimum. Une phrase fait très bien l’affaire."
              >
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </Field>
              <button
                type="button"
                className="text-button"
                onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
              >
                {mode === 'login' ? 'Créer un compte' : 'J’ai déjà un compte'}
              </button>
              <button type="button" className="text-button" onClick={() => setMode('welcome')}>
                Essayer la démonstration sans compte
              </button>
            </Form>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <span className="auth-foot">CaRM · Le garage, en mouvement.</span>
      </div>
    </main>
  );
}
