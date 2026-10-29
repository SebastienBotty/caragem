'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { money, totals, type Line } from '@/lib/domain';
import { useGarage } from '../provider';
import { Field, Form, Modal, value } from '../ui';

export function DocumentForm({
  kind,
  vehicleId = '',
  close,
}: {
  kind: 'estimate' | 'invoice';
  vehicleId?: string;
  close: () => void;
}) {
  const { state, act } = useGarage();
  const [vId, setVId] = useState(vehicleId);
  const [tax, setTax] = useState(state.settings.country === 'BE' ? 21 : 20);
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent');
  const [discountValue, setDiscountValue] = useState(0);
  const discountRate = discountType === 'percent' ? discountValue : 0;
  const discountAmount = discountType === 'amount' ? Math.round(discountValue * 100) : 0;
  const suggested = (id: string): Line[] => {
    const v = state.vehicles.find((v) => v.id === id);
    if (!v) return [{ label: '', quantity: 1, unitPrice: 0 }];
    const used = state.reservations
      .filter((r) => r.vehicleId === id && r.consumed)
      .map((r) => {
        const p = state.parts.find((p) => p.id === r.partId)!;
        return { label: p.name, quantity: r.quantity, unitPrice: p.price };
      });
    const minutes = v.tasks.reduce((n, t) => n + t.minutes, 0);
    return [
      ...used,
      {
        label: 'Main-d’œuvre · ' + v.issue,
        quantity: minutes ? Math.round((minutes / 60) * 100) / 100 : 1,
        unitPrice: 6500,
      },
    ];
  };
  const [lines, setLines] = useState<Line[]>(suggested(vehicleId));
  const t = totals(lines, tax, discountRate, discountAmount);
  return (
    <Modal
      wide
      title={kind === 'estimate' ? 'Préparer un devis' : 'Préparer une facture'}
      subtitle="Document de travail du MVP. Vérifiez chaque montant avant de l’utiliser."
      close={close}
    >
      <Form
        label="Créer le brouillon"
        onSubmit={async () => {
          await act({
            type: 'document',
            vehicleId: vId,
            kind,
            lines,
            taxRate: tax,
            discountRate,
            discountAmount,
          });
          close();
        }}
      >
        <Field label="Dossier véhicule">
          <select
            required
            value={vId}
            onChange={(e) => {
              setVId(e.target.value);
              setLines(suggested(e.target.value));
            }}
          >
            <option value="">Sélectionner un véhicule</option>
            {state.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate} · {v.model} · visite {v.visit}
              </option>
            ))}
          </select>
        </Field>
        <div className="document-lines">
          <div className="line-head">
            <span>Prestation / pièce</span>
            <span>Quantité</span>
            <span>Prix HT (€)</span>
            <span />
          </div>
          {lines.map((l, i) => (
            <div className="line-input" key={i}>
              <input
                aria-label={`Libellé ligne ${i + 1}`}
                placeholder="Prestation ou pièce"
                required
                maxLength={200}
                value={l.label}
                onChange={(e) =>
                  setLines((ls) =>
                    ls.map((x, n) => (n === i ? { ...x, label: e.target.value } : x)),
                  )
                }
              />
              <input
                aria-label={`Quantité ligne ${i + 1}`}
                required
                type="number"
                min={0.01}
                max={10000}
                step="0.01"
                value={l.quantity}
                onChange={(e) =>
                  setLines((ls) =>
                    ls.map((x, n) => (n === i ? { ...x, quantity: Number(e.target.value) } : x)),
                  )
                }
              />
              <input
                aria-label={`Prix ligne ${i + 1}`}
                required
                type="number"
                min={0}
                max={1000000}
                step="0.01"
                value={l.unitPrice / 100}
                onChange={(e) =>
                  setLines((ls) =>
                    ls.map((x, n) =>
                      n === i
                        ? {
                            ...x,
                            unitPrice: Math.round(Number(e.target.value) * 100),
                          }
                        : x,
                    ),
                  )
                }
              />
              <button
                className="icon-button"
                type="button"
                disabled={lines.length === 1}
                aria-label="Supprimer la ligne"
                onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="text-button"
          onClick={() => setLines((l) => [...l, { label: '', quantity: 1, unitPrice: 0 }])}
        >
          <Plus size={15} /> Ajouter une ligne
        </button>
        <div className="document-total">
          <Field label="Ristourne (%)">
            <input
              aria-label="Ristourne globale en pourcentage"
              required
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={
                discountType === 'percent'
                  ? discountValue
                  : t.subtotal
                    ? Math.round((t.discount * 10000) / t.subtotal) / 100
                    : 0
              }
              onChange={(e) => {
                setDiscountType('percent');
                setDiscountValue(Number(e.target.value));
              }}
            />
          </Field>
          <Field label="Ristourne (€ HT)">
            <input
              aria-label="Ristourne globale en euros HT"
              required
              type="number"
              min={0}
              max={t.subtotal / 100}
              step="0.01"
              value={discountType === 'amount' ? discountValue : t.discount / 100}
              onChange={(e) => {
                setDiscountType('amount');
                setDiscountValue(Number(e.target.value));
              }}
            />
          </Field>
          <Field label="TVA (%)">
            <input
              aria-label="Taux de TVA"
              required
              type="number"
              min={0}
              max={30}
              step="0.1"
              value={tax}
              onChange={(e) => setTax(Number(e.target.value))}
            />
          </Field>
          <div>
            {discountValue > 0 && (
              <>
                <span>
                  Sous-total HT <b>{money(t.subtotal)}</b>
                </span>
                <span>
                  {discountType === 'percent' ? `Ristourne (${discountRate} %)` : 'Ristourne (€)'}{' '}
                  <b>{money(-t.discount)}</b>
                </span>
              </>
            )}
            <span>
              Total HT <b>{money(t.net)}</b>
            </span>
            <span>
              TVA <b>{money(t.tax)}</b>
            </span>
            <strong>
              Total TTC <b>{money(t.gross)}</b>
            </strong>
          </div>
        </div>
      </Form>
    </Modal>
  );
}
