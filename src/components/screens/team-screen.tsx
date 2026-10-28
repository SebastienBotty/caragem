'use client';
import { useState } from 'react';
import { Plus, Copy, Check } from 'lucide-react';
import { useGarage, request } from '../provider';
import { Avatar, Badge, Button, Field, Form, Modal, value } from '../ui';

export function TeamScreen() {
  const { state, user } = useGarage();
  const [invite, setInvite] = useState(false);
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Un atelier, une équipe.</h2>
          <p>Chacun son compte. Un garage partagé en temps réel.</p>
        </div>
        {user.role === 'owner' && (
          <Button className="primary" onClick={() => setInvite(true)}>
            <Plus size={16} />
            Inviter un collaborateur
          </Button>
        )}
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
      {invite && (
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
