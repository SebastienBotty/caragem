'use client';
import { useState } from 'react';
import { Plus, CarFront, ArrowUpRight } from 'lucide-react';
import { stages } from '@/lib/domain';
import { useGarage } from '../provider';
import { Badge, Button, Empty, formatDate } from '../ui';
import { VehicleForm } from '../forms';

export function VehiclesScreen({
  selectVehicle,
  search,
}: {
  selectVehicle: (id: string) => void;
  search: string;
}) {
  const { state, can } = useGarage();
  const [create, setCreate] = useState(false);
  const [filter, setFilter] = useState('active');
  const vehicles = state.vehicles.filter(
    (v) =>
      (filter === 'all' ||
        (filter === 'history' ? v.stage === 'returned' : v.stage !== 'returned')) &&
      `${v.model} ${v.plate} ${state.customers.find((c) => c.id === v.customerId)?.name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="section-toolbar">
        <div>
          <h2>Chaque véhicule a son histoire.</h2>
          <p>Retrouvez les visites en cours et les interventions passées.</p>
        </div>
        {can('vehicles.create') && (
          <Button className="primary" onClick={() => setCreate(true)}>
            <Plus size={16} />
            Nouvelle arrivée
          </Button>
        )}
      </div>
      <div className="data-panel">
        <div className="panel-toolbar">
          <div className="segmented">
            {[
              ['active', 'Au garage'],
              ['history', 'Historique'],
              ['all', 'Toutes les visites'],
            ]
              .filter(([key]) => key === 'active' || can('history.view'))
              .map(([key, label]) => (
                <button
                  className={filter === key ? 'active' : ''}
                  key={key}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
          </div>
        </div>
        {!vehicles.length ? (
          <Empty
            title="Aucun véhicule dans cette vue"
            text="Les nouvelles arrivées et les anciennes visites apparaîtront ici."
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Véhicule</th>
                  <th>Client</th>
                  <th>Intervention</th>
                  <th>Étape</th>
                  <th>Restitution</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => {
                  const st = stages.find((s) => s.id === v.stage);
                  return (
                    <tr key={v.id}>
                      <td>
                        <div className="table-car">
                          <CarFront size={28} style={{ color: v.color }} />
                          <span>
                            <strong>{v.model}</strong>
                            <small className="mono">{v.plate}</small>
                          </span>
                        </div>
                      </td>
                      <td>{state.customers.find((c) => c.id === v.customerId)?.name}</td>
                      <td>
                        {v.issue}
                        <small>
                          Visite {v.visit} · {v.mileage.toLocaleString('fr-FR')} km
                        </small>
                      </td>
                      <td>
                        <Badge
                          tone={
                            v.stage === 'ready' ? 'green' : v.stage === 'returned' ? '' : 'blue'
                          }
                        >
                          {st?.short ?? 'Clôturé'}
                        </Badge>
                      </td>
                      <td>{formatDate(v.due)}</td>
                      <td>
                        <button
                          className="icon-button"
                          title="Ouvrir le dossier"
                          aria-label={`Ouvrir ${v.plate}`}
                          onClick={() => selectVehicle(v.id)}
                        >
                          <ArrowUpRight size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {create && can('vehicles.create') && <VehicleForm close={() => setCreate(false)} />}
    </>
  );
}
