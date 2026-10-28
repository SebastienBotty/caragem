'use client';
import { useState } from 'react';
import { Download, Check, ArrowRight, Euro } from 'lucide-react';
import { money, totals, type Document } from '@/lib/domain';
import { useGarage } from '../provider';
import { Badge, Button, Field, Form, Modal, cents, formatDate, value } from '../ui';

export function DocumentDetail({ document, close }: { document: Document; close: () => void }) {
  const { state, user, act } = useGarage();
  const v = state.vehicles.find((v) => v.id === document.vehicleId)!;
  const customer = state.customers.find((c) => c.id === v.customerId)!;
  const t = totals(document.lines, document.taxRate);
  const manage = user.role !== 'mechanic';
  const [payment, setPayment] = useState(false);
  const [accept, setAccept] = useState(false);
  return (
    <>
      <Modal
        wide
        title={document.number}
        subtitle={`${document.kind === 'estimate' ? 'Devis' : 'Facture'} · ${v.plate} · ${customer.name}`}
        close={close}
      >
        <div className="document-preview">
          <div className="document-brand">
            <strong>{state.settings.name}</strong>
            <Badge tone="amber">BROUILLON MVP</Badge>
          </div>
          <p>
            {state.settings.address}
            <br />
            {state.settings.businessId}
          </p>
          <div className="document-recipient">
            <div>
              <small>CLIENT</small>
              <strong>{customer.name}</strong>
              <span>{customer.email}</span>
            </div>
            <div>
              <small>VÉHICULE</small>
              <strong>
                {v.model} · {v.plate}
              </strong>
              <span>
                {v.mileage.toLocaleString('fr-FR')} km · {formatDate(document.createdAt, false)}
              </span>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Désignation</th>
                <th>Qté</th>
                <th>Prix HT</th>
                <th>Total HT</th>
              </tr>
            </thead>
            <tbody>
              {document.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.label}</td>
                  <td>{l.quantity}</td>
                  <td>{money(l.unitPrice)}</td>
                  <td>{money(Math.round(l.unitPrice * l.quantity))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="totals-summary">
            <span>
              Total HT <b>{money(t.net)}</b>
            </span>
            <span>
              TVA ({document.taxRate} %) <b>{money(t.tax)}</b>
            </span>
            <strong>
              Total TTC <b>{money(t.gross)}</b>
            </strong>
            {document.kind === 'invoice' && (
              <>
                <span>
                  Déjà réglé <b>{money(document.paid)}</b>
                </span>
                <strong>
                  Reste à régler <b>{money(t.gross - document.paid)}</b>
                </strong>
              </>
            )}
          </div>
          <p className="document-disclaimer">
            Document de démonstration / de travail. Les mentions et obligations de facturation
            doivent être validées avant usage commercial.
          </p>
        </div>
        <div className="modal-actions">
          <a className="button" href={`/api/document/${document.id}`}>
            <Download size={16} /> Télécharger le PDF
          </a>
          {manage && document.kind === 'estimate' && !document.accepted && (
            <Button className="primary" onClick={() => setAccept(true)}>
              <Check size={16} /> Enregistrer l’accord
            </Button>
          )}
          {manage && document.kind === 'estimate' && document.accepted && (
            <Button
              className="primary"
              onClick={async () => {
                try {
                  await act({ type: 'convertEstimate', id: document.id });
                  close();
                } catch (e) {
                  alert((e as Error).message);
                }
              }}
            >
              Créer la facture
              <ArrowRight size={16} />
            </Button>
          )}
          {manage && document.kind === 'invoice' && document.paid < t.gross && (
            <Button className="primary" onClick={() => setPayment(true)}>
              <Euro size={16} /> Ajouter un paiement
            </Button>
          )}
        </div>
      </Modal>
      {payment && (
        <Modal title="Enregistrer un paiement" close={() => setPayment(false)}>
          <Form
            onSubmit={async (f) => {
              await act({
                type: 'payment',
                id: document.id,
                amount: cents(f, 'amount'),
              });
              setPayment(false);
            }}
          >
            <Field label="Montant reçu (€)">
              <input
                name="amount"
                required
                type="number"
                min={0.01}
                max={(t.gross - document.paid) / 100}
                step="0.01"
                defaultValue={(t.gross - document.paid) / 100}
              />
            </Field>
            <p className="muted">
              Le paiement est enregistré dans le suivi. Aucun débit bancaire n’est effectué.
            </p>
          </Form>
        </Modal>
      )}
      {accept && (
        <Modal title="Accord sur le devis" close={() => setAccept(false)}>
          <Form
            onSubmit={async (f) => {
              await act({
                type: 'acceptEstimate',
                id: document.id,
                evidence: value(f, 'evidence'),
              });
              setAccept(false);
            }}
          >
            <Field label="Comment l’accord a-t-il été reçu ?">
              <input
                name="evidence"
                required
                maxLength={200}
                placeholder="Accord téléphonique de Mme Dubois, ce jour à 10 h"
              />
            </Field>
          </Form>
        </Modal>
      )}
    </>
  );
}
