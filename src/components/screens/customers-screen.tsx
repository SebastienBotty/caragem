'use client';
import { useState } from 'react';
import { Plus, CarFront, ArrowUpRight } from 'lucide-react';
import { useGarage } from '../provider';
import { Avatar, Badge, Button, Empty } from '../ui';
import { CustomerForm } from '../forms';

export function CustomersScreen({
  selectVehicle,
  search,
}: {
  selectVehicle: (id: string) => void;
  search: string;
}) {
  const { state, can } = useGarage();
  const [create, setCreate] = useState(false);
  const [expanded, setExpanded] = useState('');
  const clients = state.customers.filter((c) =>
    `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Les personnes derrière les voitures.</h2>
          <p>{state.customers.length} clients et leur historique, au même endroit.</p>
        </div>
        {can('customers.manage') && (
          <Button className="primary" onClick={() => setCreate(true)}>
            <Plus size={16} />
            Nouveau client
          </Button>
        )}
      </div>
      {!clients.length ? (
        <Empty
          title="Votre carnet de clients commence ici"
          text="Ajoutez un client pour enregistrer son premier véhicule."
        />
      ) : (
        <div className="customer-grid">
          {clients.map((c) => {
            const vehicles = state.vehicles.filter((v) => v.customerId === c.id);
            return (
              <article className="customer-card" key={c.id}>
                <div className="customer-card-top">
                  <Avatar name={c.name} color="#6983a8" />
                  <div>
                    <h3>{c.name}</h3>
                    <span>{new Set(vehicles.map((v) => v.plate)).size} véhicule(s)</span>
                  </div>
                </div>
                <a href={`mailto:${c.email}`}>{c.email}</a>
                <a href={`tel:${c.phone}`}>{c.phone || 'Téléphone non renseigné'}</a>
                <button
                  className="customer-history"
                  onClick={() => setExpanded(expanded === c.id ? '' : c.id)}
                >
                  Dossiers et historique{' '}
                  <span>
                    {vehicles.length}
                    <ArrowUpRight size={15} />
                  </span>
                </button>
                {expanded === c.id && (
                  <div className="customer-vehicles">
                    {vehicles.map((v) => (
                      <button key={v.id} onClick={() => selectVehicle(v.id)}>
                        <CarFront size={17} />
                        <span>
                          <b>{v.plate}</b>
                          <small>
                            {v.model} · visite {v.visit}
                          </small>
                        </span>
                        <Badge tone={v.stage === 'returned' ? '' : 'blue'}>
                          {v.stage === 'returned' ? 'Clôturé' : 'En cours'}
                        </Badge>
                      </button>
                    ))}
                    {!vehicles.length && <p className="muted">Aucun dossier pour le moment.</p>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {create && can('customers.manage') && <CustomerForm close={() => setCreate(false)} />}
    </>
  );
}
