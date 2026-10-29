'use client';
import { useState } from 'react';
import { Plus, ArrowRight, Receipt } from 'lucide-react';
import { money, totals } from '@/lib/domain';
import { useGarage } from '../provider';
import { Badge, Button, Empty, formatDate } from '../ui';
import { DocumentForm } from './document-form';
import { DocumentDetail } from './document-detail';
export function DocumentsScreen({
  kind,
  selectVehicle,
}: {
  kind: 'estimate' | 'invoice';
  selectVehicle: (id: string) => void;
}) {
  const { state, can } = useGarage();
  const [create, setCreate] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const all = state.documents.filter((d) => d.kind === kind);
  const docs = all.filter(
    (d) =>
      filter !== 'open' ||
      (kind === 'invoice' ? d.paid < totals(d.lines, d.taxRate).gross : !d.accepted),
  );
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>{kind === 'invoice' ? 'La facturation, au clair.' : 'Des devis bien suivis.'}</h2>
          <p>
            {kind === 'invoice'
              ? 'Retrouvez vos documents et les règlements enregistrés.'
              : 'Préparez vos propositions et conservez l’accord du client.'}
          </p>
        </div>
        {can('documents.prepare') && (
          <Button className="primary" data-tour="document-create" onClick={() => setCreate(true)}>
            <Plus size={16} />
            {kind === 'invoice' ? 'Nouvelle facture' : 'Nouveau devis'}
          </Button>
        )}
      </div>
      <div className="notice">
        <Receipt size={17} />
        <span>
          Les documents du MVP sont des brouillons de travail, sans garantie de conformité
          comptable.
        </span>
      </div>
      {kind === 'invoice' && can('finances.view') && (
        <div className="inventory-stats" aria-label="Statistiques financières">
          <div>
            <span>
              Total facturé
              <strong>
                {money(all.reduce((sum, d) => sum + totals(d.lines, d.taxRate).gross, 0))}
              </strong>
            </span>
          </div>
          <div>
            <span>
              Paiements enregistrés<strong>{money(all.reduce((sum, d) => sum + d.paid, 0))}</strong>
            </span>
          </div>
          <div>
            <span>
              Reste à régler
              <strong>
                {money(all.reduce((sum, d) => sum + totals(d.lines, d.taxRate).gross - d.paid, 0))}
              </strong>
            </span>
          </div>
        </div>
      )}
      <div className="data-panel">
        <div className="panel-toolbar">
          <div className="segmented">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              Tous <b>{all.length}</b>
            </button>
            <button className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}>
              {kind === 'invoice' ? 'À régler' : 'En attente d’accord'}
            </button>
          </div>
        </div>
        {!docs.length ? (
          <Empty
            title="Aucun document ici"
            text="Les documents préparés depuis un dossier apparaîtront ici."
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Client / véhicule</th>
                  <th>Date</th>
                  <th>Total TTC</th>
                  <th>État</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const v = state.vehicles.find((v) => v.id === d.vehicleId)!;
                  const c = state.customers.find((c) => c.id === v.customerId)!;
                  const t = totals(d.lines, d.taxRate);
                  return (
                    <tr key={d.id}>
                      <td>
                        <button className="table-link" onClick={() => setDetail(d.id)}>
                          {d.number}
                        </button>
                        <small>{d.validated ? 'Validée' : 'Brouillon'}</small>
                      </td>
                      <td>
                        <strong>{c.name}</strong>
                        <button className="sub-link" onClick={() => selectVehicle(v.id)}>
                          {v.plate} · {v.model}
                        </button>
                      </td>
                      <td>{formatDate(d.createdAt, false)}</td>
                      <td>
                        <strong>{money(t.gross)}</strong>
                        {kind === 'invoice' && d.paid > 0 && <small>{money(d.paid)} réglés</small>}
                      </td>
                      <td>
                        <Badge
                          tone={
                            kind === 'invoice'
                              ? d.paid >= t.gross
                                ? 'green'
                                : 'amber'
                              : d.accepted
                                ? 'green'
                                : 'blue'
                          }
                        >
                          {kind === 'invoice'
                            ? d.paid >= t.gross
                              ? 'Réglée'
                              : d.paid
                                ? 'Partiellement réglée'
                                : 'À régler'
                            : d.accepted
                              ? 'Accord enregistré'
                              : 'Accord attendu'}
                        </Badge>
                      </td>
                      <td>
                        <Button onClick={() => setDetail(d.id)}>
                          Ouvrir
                          <ArrowRight size={14} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {create && can('documents.prepare') && (
        <DocumentForm kind={kind} close={() => setCreate(false)} />
      )}
      {detail && state.documents.some((d) => d.id === detail) && (
        <DocumentDetail
          document={state.documents.find((d) => d.id === detail)!}
          close={() => setDetail(null)}
        />
      )}
    </>
  );
}
