'use client';
import { useEffect, useState } from 'react';
import { useGarage } from './provider';
import { Button, Field, Form, value } from './ui';

type Profile = { name: string; firstName: string; lastName: string; avatar: string | null };
const fileData = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('La photo n’a pas pu être lue.'));
    reader.readAsDataURL(file);
  });

export function AccountProfilePanel() {
  const { account, request, refresh, notify } = useGarage();
  const [profile, setProfile] = useState<Profile>();
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ email: string; oldCodeRequired: boolean }>();
  useEffect(() => {
    let mounted = true;
    request<{ profile: Profile }>('account/profile')
      .then((result) => {
        if (mounted) setProfile(result.profile);
      })
      .catch((error) => {
        if (mounted) setError(error.message);
      });
    return () => {
      mounted = false;
    };
  }, [request, account?.email]);
  return (
    <>
      <section className="data-panel settings-card">
        <h3>Profil personnel</h3>
        <p>Votre nom et votre photo sont visibles par les équipes de vos garages.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {profile && (
          <Form
            key={`${profile.name}-${profile.avatar?.length}`}
            label="Enregistrer mon profil"
            onSubmit={async (form) => {
              const file = form.get('avatar');
              if (file instanceof File && file.size > 2 * 1024 * 1024)
                throw new Error('La photo doit faire au maximum 2 Mio.');
              const avatar =
                file instanceof File && file.size
                  ? await fileData(file)
                  : removeAvatar
                    ? null
                    : undefined;
              await request('account/profile', {
                firstName: value(form, 'firstName'),
                lastName: value(form, 'lastName'),
                ...(avatar === undefined ? {} : { avatar }),
              });
              const result = await request<{ profile: Profile }>('account/profile');
              setProfile(result.profile);
              setRemoveAvatar(false);
              await refresh();
              notify('Profil personnel enregistré.');
            }}
          >
            <Field label="Prénom">
              <input
                name="firstName"
                autoComplete="given-name"
                maxLength={50}
                required
                defaultValue={profile.firstName || profile.name.split(' ')[0]}
              />
            </Field>
            <Field label="Nom">
              <input
                name="lastName"
                autoComplete="family-name"
                maxLength={50}
                required
                defaultValue={profile.lastName || profile.name.split(' ').slice(1).join(' ')}
              />
            </Field>
            {profile.avatar && !removeAvatar && (
              <img
                src={profile.avatar}
                alt="Votre photo de profil"
                width={80}
                height={80}
                style={{ borderRadius: '50%', objectFit: 'cover' }}
              />
            )}
            <Field
              label="Photo de profil"
              hint="JPEG, PNG ou WebP · 2 Mio maximum. La photo est recadrée en carré."
            >
              <input name="avatar" type="file" accept="image/jpeg,image/png,image/webp" />
            </Field>
            {profile.avatar && (
              <Button type="button" onClick={() => setRemoveAvatar(!removeAvatar)}>
                {removeAvatar ? 'Conserver ma photo' : 'Retirer ma photo'}
              </Button>
            )}
          </Form>
        )}
      </section>
      <section className="data-panel settings-card">
        <h3>Adresse de connexion</h3>
        <p>{account?.email}</p>
        <p>
          Le changement doit être confirmé avec un code envoyé à la nouvelle adresse. Vos accès aux
          garages et votre connexion Google sont conservés.
        </p>
        {pending ? (
          <Form
            label="Confirmer la nouvelle adresse"
            onSubmit={async (form) => {
              await request('account/email/confirm', {
                code: value(form, 'code'),
                ...(pending.oldCodeRequired ? { oldCode: value(form, 'oldCode') } : {}),
              });
              setPending(undefined);
              await refresh();
              notify('Adresse mail modifiée. Les autres sessions ont été déconnectées.');
            }}
          >
            <p>Un code a été envoyé à {pending.email}. Il expire dans 10 minutes.</p>
            <Field label="Code reçu sur la nouvelle adresse">
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
              />
            </Field>
            {pending.oldCodeRequired && (
              <Field
                label="Code reçu sur l’adresse actuelle"
                hint="Cette seconde vérification protège les comptes connectés avec Google."
              >
                <input
                  name="oldCode"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                />
              </Field>
            )}
            <Button type="button" onClick={() => setPending(undefined)}>
              Recommencer la demande
            </Button>
          </Form>
        ) : (
          <Form
            label="Vérifier la nouvelle adresse"
            onSubmit={async (form) => {
              const email = value(form, 'email');
              const result = await request<{ oldCodeRequired: boolean }>('account/email/start', {
                email,
                ...(account?.hasPassword ? { password: value(form, 'password') } : {}),
                ...(value(form, 'securityCode')
                  ? { securityCode: value(form, 'securityCode') }
                  : {}),
              });
              setPending({ email, oldCodeRequired: result.oldCodeRequired });
            }}
          >
            <Field label="Nouvelle adresse mail">
              <input name="email" type="email" autoComplete="email" maxLength={254} required />
            </Field>
            {account?.hasPassword && (
              <Field label="Mot de passe actuel">
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  maxLength={128}
                  required
                />
              </Field>
            )}
            {account?.twoFactorEnabled && (
              <Field
                label="Code de double authentification"
                hint="Vous pouvez aussi utiliser un code de secours."
              >
                <input name="securityCode" autoComplete="one-time-code" maxLength={100} required />
              </Field>
            )}
          </Form>
        )}
      </section>
    </>
  );
}
