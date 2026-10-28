'use client';
import { useState } from 'react';
import { Plus, Search, Package, Truck, AlertTriangle, ArrowDownToLine } from 'lucide-react';
import { available, money } from '@/lib/domain';
import { useGarage } from '../provider';
import { Badge, Button, Empty, Field, Form, Modal, formatDate, number, value } from '../ui';
import { OrderForm, PartForm } from '../forms';

export function InventoryScreen() {
  const { state, can, act } = useGarage();
  const [tab, setTab] = useState('stock');
  const [dialog, setDialog] = useState('');
  const [item, setItem] = useState('');
  const [search, setSearch] = useState('');
  const manage = can('stock.manage');
  const low = state.parts.filter((p) => available(state, p.id) < p.min).length;
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>La bonne pièce, au bon moment.</h2>
          <p>Stock, réservations et commandes fournisseurs.</p>
        </div>
        {manage && (
          <div className="toolbar-actions">
            <Button onClick={() => setDialog('order')}>
              <Truck size={16} />
              Enregistrer une commande
            </Button>
            <Button className="primary" onClick={() => setDialog('part')}>
              <Plus size={16} />
              Ajouter une pièce
            </Button>
          </div>
        )}
      </div>
      <div className="inventory-stats">
        <div>
          <Package size={20} />
          <span>
            <strong>{state.parts.length}</strong> références
          </span>
        </div>
        <div>
          <AlertTriangle size={20} />
          <span>
            <strong>{low}</strong> sous le seuil
          </span>
        </div>
        <div>
          <Truck size={20} />
          <span>
            <strong>{state.orders.filter((o) => o.received < o.quantity).length}</strong> commandes
            attendues
          </span>
        </div>
      </div>
      <div className="data-panel">
        <div className="panel-toolbar">
          <div className="segmented">
            <button className={tab === 'stock' ? 'active' : ''} onClick={() => setTab('stock')}>
              Stock et disponibilités
            </button>
            <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>
              Commandes
            </button>
          </div>
          <label className="inline-search">
            <Search size={15} />
            <input
              aria-label="Rechercher une pièce ou une commande"
              placeholder="Rechercher…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {tab === 'stock' ? (
          state.parts.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Pièce</th>
                    <th>Fournisseur</th>
                    <th>En stock</th>
                    <th>Réservées</th>
                    <th>Disponibles</th>
                    <th>Achat / Vente HT</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {state.parts
                    .filter((p) =>
                      `${p.name} ${p.reference}`.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong>
                          <small className="mono">{p.reference}</small>
                        </td>
                        <td>{p.supplier}</td>
                        <td>{p.stock}</td>
                        <td>{p.stock - available(state, p.id)}</td>
                        <td>
                          <Badge tone={available(state, p.id) < p.min ? 'amber' : 'green'}>
                            {available(state, p.id)} disponible(s)
                          </Badge>
                        </td>
                        <td>
                          {money(p.cost)} / {money(p.price)}
                        </td>
                        <td>
                          {manage && (
                            <Button
                              onClick={() => {
                                setItem(p.id);
                                setDialog('adjust');
                              }}
                            >
                              Ajuster
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Un stock bien rangé commence ici"
              text="Ajoutez vos pièces et consommables pour les réserver aux interventions."
            />
          )
        ) : state.orders.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Commande</th>
                  <th>Pièce / destination</th>
                  <th>Livraison prévue</th>
                  <th>Réception</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.orders
                  .filter((o) =>
                    `${o.reference} ${o.supplier}`.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((o) => (
                    <tr key={o.id}>
                      <td>
                        <strong>{o.reference}</strong>
                        <small>{o.supplier}</small>
                      </td>
                      <td>
                        {state.parts.find((p) => p.id === o.partId)?.name}
                        <small>
                          {state.vehicles.find((v) => v.id === o.vehicleId)?.plate ??
                            'Réapprovisionnement'}
                        </small>
                      </td>
                      <td>{formatDate(o.due)}</td>
                      <td>
                        <Badge tone={o.received === o.quantity ? 'green' : 'amber'}>
                          {o.received}/{o.quantity} reçues
                        </Badge>
                      </td>
                      <td>
                        {manage && o.received < o.quantity && (
                          <Button
                            onClick={() => {
                              setItem(o.id);
                              setDialog('receive');
                            }}
                          >
                            <ArrowDownToLine size={14} />
                            Réceptionner
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Aucune commande enregistrée"
            text="Conservez ici le suivi des commandes passées à vos fournisseurs."
          />
        )}
      </div>
      {dialog === 'part' && manage && <PartForm close={() => setDialog('')} />}
      {dialog === 'order' && manage && <OrderForm close={() => setDialog('')} />}
      {dialog === 'adjust' && manage && (
        <Modal title="Ajuster le stock" close={() => setDialog('')}>
          <Form
            onSubmit={async (f) => {
              await act({
                type: 'adjustStock',
                id: item,
                delta: number(f, 'delta'),
                reason: value(f, 'reason'),
              });
              setDialog('');
            }}
          >
            <Field
              label="Variation de quantité"
              hint="Exemple : +3 pour une entrée, -1 pour une sortie."
            >
              <input
                name="delta"
                required
                type="number"
                min={-100000}
                max={100000}
                defaultValue={1}
              />
            </Field>
            <Field label="Motif">
              <input
                name="reason"
                required
                maxLength={200}
                placeholder="Correction d’inventaire, retour…"
              />
            </Field>
          </Form>
        </Modal>
      )}
      {dialog === 'receive' && manage && (
        <Modal title="Réceptionner la commande" close={() => setDialog('')}>
          <Form
            onSubmit={async (f) => {
              await act({
                type: 'receive',
                id: item,
                quantity: number(f, 'quantity'),
              });
              setDialog('');
            }}
          >
            <Field label="Quantité reçue aujourd’hui">
              <input
                name="quantity"
                required
                type="number"
                min={1}
                max={
                  state.orders.find((o) => o.id === item)!.quantity -
                  state.orders.find((o) => o.id === item)!.received
                }
                defaultValue={1}
              />
            </Field>
            <p className="muted">
              Une réception partielle reste possible. Seules les quantités reçues entrent en stock.
            </p>
          </Form>
        </Modal>
      )}
    </>
  );
}
