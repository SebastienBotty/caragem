'use client';
import { useEffect, useState } from 'react';
import { Plus, Copy, Check } from 'lucide-react';
import { useGarage, request } from '../provider';
import { Avatar, Badge, Button, Field, Form, Modal, value } from '../ui';

export function TeamScreen() {
  const { state, user } = useGarage();
  const [invite, setInvite] = useState(false);
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<
    { id: string; email: string; role: string; expires: number }[]
  >([]);
  const [error, setError] = useState('');
  const load = async () => {
    try {
      const data = await request<{ invitations: typeof pending }>('invitations');
      setPending(data.invitations);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (user.role === 'owner') void load();
    else setPending([]);
  }, [user.role, state.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Un atelier, une équipe.</h2>
          <p>Chacun son compte. Un garage partagé en temps réel.</p>
        </div>
        <div className="toolbar-actions">
          {user.role === 'owner' && (
            <Button className="primary" onClick={() => setInvite(true)}>
              <Plus size={16} />
              Inviter un collaborateur
            </Button>
          )}
        </div>
      </div>
      <div className="team-grid">
        {state.users.map((u) => {
          const tasks = state.vehicles
            .flatMap((v) => v.tasks)
            .filter((t) => t.assignees.includes(u.id));
          return (
            <article className="team-card" key={u.id}>
              <Avatar name={u.name} color={u.color} />
              <h3>
                {u.name}
                {u.id === user.id && <small>Vous</small>}
              </h3>
              <Badge tone={u.role === 'owner' ? 'blue' : ''}>
                {u.role === 'owner'
                  ? 'Responsable'
                  : u.role === 'reception'
                    ? 'Accueil'
                    : 'Mécanicien'}
              </Badge>
              <div className="team-counts">
                <span>
                  <b>{tasks.filter((t) => t.status === 'doing').length}</b>En cours
                </span>
                <span>
                  <b>{tasks.filter((t) => t.status === 'todo').length}</b>À faire
                </span>
                <span>
                  <b>{tasks.filter((t) => t.status === 'done').length}</b>
                  Terminées
                </span>
              </div>
            </article>
          );
        })}
      </div>
      {user.role === 'owner' && (
        <section className="data-panel settings-card">
          <h3>Invitations en attente</h3>
          <p>Les liens sont personnels et expirent après 7 jours.</p>
          {pending.length ? (
            pending.map((item) => (
              <div className="pending-invitation" key={item.id}>
                <span>
                  <strong>{item.email}</strong>
                  <small>
                    {item.role === 'mechanic' ? 'Mécanicien' : 'Accueil'} · Expire le{' '}
                    {new Date(item.expires).toLocaleDateString('fr-FR')}
                  </small>
                </span>
                <Button
                  onClick={async () => {
                    try {
                      await request('revoke-invitation', { id: item.id });
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Révoquer
                </Button>
              </div>
            ))
          ) : (
            <p className="muted">Aucune invitation en attente.</p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
      {invite && user.role === 'owner' && (
        <Modal
          title="Inviter un collaborateur"
          subtitle="Le lien est personnel, valable 7 jours et utilisable une seule fois."
          close={() => {
            setInvite(false);
            setUrl('');
          }}
        >
          <Form
            label="Créer le lien d’invitation"
            onSubmit={async (f) => {
              const result = await request<{ url: string }>('invite', {
                email: value(f, 'email'),
                role: value(f, 'role'),
              });
              setUrl(result.url);
              setCopied(false);
              await load();
            }}
          >
            <Field label="Adresse mail du collaborateur">
              <input name="email" type="email" required />
            </Field>
            <Field label="Rôle">
              <select name="role">
                <option value="mechanic">Mécanicien</option>
                <option value="reception">Accueil</option>
              </select>
            </Field>
          </Form>
          {url && (
            <div className="invite-result">
              <p>Transmettez ce lien au collaborateur :</p>
              <input
                aria-label="Lien d’invitation"
                readOnly
                value={url}
                onFocus={(e) => e.target.select()}
              />
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? 'Copié' : 'Copier le lien'}
              </Button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
