'use client';
import { useState } from 'react';
import { ArrowUpRight, Mail, Send } from 'lucide-react';
import { useGarage } from '../provider';
import { Badge, Button, Empty, Field, Form, Modal, formatDate, number, value } from '../ui';

export function MessagesScreen() {
  const { state, user, act, api, notify, smtp } = useGarage();
  const [selected, setSelected] = useState('');
  const mail = state.mails.find((m) => m.id === selected);
  const [sending, setSending] = useState(false);
  const [dirty, setDirty] = useState(false);
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Le bon message, au bon moment.</h2>
          <p>Chaque mail est vérifié et validé par votre équipe avant de partir.</p>
        </div>
        <Badge tone="amber">
          {state.mails.filter((m) => m.status === 'draft').length} à valider
        </Badge>
      </div>
      {!smtp && (
        <div className="notice">
          <Mail size={17} />
          <span>
            Les brouillons sont disponibles. Configurez le SMTP dans le serveur pour activer les
            envois.
          </span>
        </div>
      )}
      <div className="data-panel">
        {state.mails.length ? (
          state.mails.map((m) => (
            <button
              className="mail-row"
              key={m.id}
              onClick={() => {
                setSelected(m.id);
                setDirty(false);
              }}
            >
              <span className="document-icon">
                <Mail size={20} />
              </span>
              <div>
                <strong>{m.subject}</strong>
                <small>{m.to}</small>
              </div>
              <Badge tone={m.status === 'sent' ? 'green' : m.status === 'failed' ? 'red' : 'amber'}>
                {m.status === 'sent'
                  ? 'Envoyé'
                  : m.status === 'sending'
                    ? 'Envoi…'
                    : m.status === 'failed'
                      ? 'Échec'
                      : 'À valider'}
              </Badge>
              <ArrowUpRight size={17} />
            </button>
          ))
        ) : (
          <Empty
            title="Aucun mail en attente"
            text="Préparez un message depuis le dossier d’un véhicule."
          />
        )}
      </div>
      {mail && (
        <Modal
          title={mail.status === 'sent' ? 'Message envoyé' : 'Vérifier le message'}
          subtitle={
            mail.sentAt
              ? `${mail.sentBy} · ${formatDate(mail.sentAt)}`
              : 'L’envoi est toujours une action explicite.'
          }
          close={() => setSelected('')}
        >
          <Form
            key={mail.id}
            hideSubmit={
              mail.status === 'sent' || mail.status === 'sending' || user.role === 'mechanic'
            }
            onChange={() => setDirty(true)}
            label="Enregistrer les modifications"
            onSubmit={async (f) => {
              await act({
                type: 'updateMail',
                documentId: value(f, 'documentId') || undefined,
                id: mail.id,
                to: value(f, 'to'),
                subject: value(f, 'subject'),
                body: value(f, 'body'),
              });
              setDirty(false);
              notify('Brouillon enregistré.');
            }}
          >
            <Field label="Destinataire">
              <input
                name="to"
                type="email"
                required
                defaultValue={mail.to}
                readOnly={
                  mail.status === 'sent' || mail.status === 'sending' || user.role === 'mechanic'
                }
              />
            </Field>
            <Field label="Document joint en PDF">
              <select
                name="documentId"
                defaultValue={mail.documentId ?? ''}
                disabled={
                  mail.status === 'sent' || mail.status === 'sending' || user.role === 'mechanic'
                }
              >
                <option value="">Aucune pièce jointe</option>
                {state.documents
                  .filter((d) => d.vehicleId === mail.vehicleId)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.number} · Brouillon
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Objet">
              <input
                name="subject"
                required
                maxLength={200}
                defaultValue={mail.subject}
                readOnly={
                  mail.status === 'sent' || mail.status === 'sending' || user.role === 'mechanic'
                }
              />
            </Field>
            <Field label="Message">
              <textarea
                name="body"
                required
                rows={9}
                defaultValue={mail.body}
                readOnly={
                  mail.status === 'sent' || mail.status === 'sending' || user.role === 'mechanic'
                }
              />
            </Field>
            {(mail.status === 'sent' || mail.status === 'sending' || user.role === 'mechanic') && (
              <p className="muted">Message en consultation.</p>
            )}
          </Form>
          {mail.error && <p className="form-error">{mail.error}</p>}
          {mail.status !== 'sent' && mail.status !== 'sending' && user.role !== 'mechanic' && (
            <div className="modal-actions">
              <p className="muted small-text">
                Enregistrez vos modifications avant de valider l’envoi.
              </p>
              <Button
                className="primary"
                busy={sending}
                disabled={dirty}
                onClick={async () => {
                  setSending(true);
                  try {
                    await api('send-mail', { id: mail.id });
                    notify('Mail envoyé.');
                    setSelected('');
                  } catch (e) {
                    notify((e as Error).message);
                  } finally {
                    setSending(false);
                  }
                }}
              >
                <Send size={15} />
                Valider et envoyer
              </Button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
