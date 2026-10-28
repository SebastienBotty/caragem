'use client';
import { useState } from 'react';
import { Plus, CarFront, ArrowUpRight } from 'lucide-react';
import { useGarage } from '../provider';
import { Avatar, Badge, Button, Empty } from '../ui';
import { CustomerForm, VehicleForm } from '../forms';
import { customerVehicles, plateKey } from '@/lib/customer-vehicles';

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
  const [arrival, setArrival] = useState<{ customerId: string; vehicleId?: string } | null>(null);
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
            const vehicles = customerVehicles(state, c.id);
            return (
              <article className="customer-card" key={c.id}>
                <div className="customer-card-top">
                  <Avatar name={c.name} color="#6983a8" />
                  <div>
                    <h3>{c.name}</h3>
                    <span>{vehicles.length} véhicule(s) enregistré(s)</span>
                  </div>
                </div>
                <a href={`mailto:${c.email}`}>{c.email}</a>
                <a href={`tel:${c.phone}`}>{c.phone || 'Téléphone non renseigné'}</a>
                {can('vehicles.create') && (
                  <Button onClick={() => setArrival({ customerId: c.id })}>
                    <Plus size={14} /> Nouvelle arrivée
                  </Button>
                )}
                {can('garage.view') && (
                  <button
                    className="customer-history"
                    onClick={() => setExpanded(expanded === c.id ? '' : c.id)}
                  >
                    Véhicules et historique{' '}
                    <span>
                      {vehicles.length}
                      <ArrowUpRight size={15} />
                    </span>
                  </button>
                )}
                {expanded === c.id && (
                  <div className="customer-vehicles">
                    {vehicles.map((v) => (
                      <details className="customer-registered-vehicle" key={v.id}>
                        <summary>
                          <CarFront size={17} />
                          <span>
                            <b>{v.plate}</b>
                            <small>
                              {v.model} · {v.mileage.toLocaleString('fr-FR')} km
                            </small>
                          </span>
                          <Badge tone={v.inGarage ? 'blue' : ''}>
                            {v.inGarage ? 'Au garage' : 'Enregistré'}
                          </Badge>
                        </summary>
                        {!v.inGarage && can('vehicles.create') && (
                          <Button onClick={() => setArrival({ customerId: c.id, vehicleId: v.id })}>
                            Nouvelle visite
                          </Button>
                        )}
                        {state.vehicles
                          .filter(
                            (visit) =>
                              visit.customerId === c.id &&
                              plateKey(visit.plate) === plateKey(v.plate),
                          )
                          .map((visit) => (
                            <button
                              key={visit.id}
                              className="customer-visit"
                              onClick={() => selectVehicle(visit.id)}
                            >
                              <span>
                                Visite {visit.visit}
                                <small>{visit.issue}</small>
                              </span>
                              <Badge tone={visit.stage === 'returned' ? '' : 'blue'}>
                                {visit.stage === 'returned' ? 'Clôturée' : 'En cours'}
                              </Badge>
                              <ArrowUpRight size={15} />
                            </button>
                          ))}
                      </details>
                    ))}
                    {!vehicles.length && (
                      <p className="muted">Aucun véhicule enregistré pour le moment.</p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {create && can('customers.manage') && <CustomerForm close={() => setCreate(false)} />}
      {arrival && can('vehicles.create') && (
        <VehicleForm
          initialCustomerId={arrival.customerId}
          initialVehicleId={arrival.vehicleId}
          close={() => setArrival(null)}
        />
      )}
    </>
  );
}
