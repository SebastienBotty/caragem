'use client';
import type { Vehicle } from '@/lib/domain';
import { interventionTime } from '@/lib/work-time';

export function VehicleTimeSummary({ vehicle }: { vehicle: Vehicle }) {
  const time = interventionTime(vehicle);
  return (
    <section className="work-time-summary" aria-label="Temps de l’intervention">
      <div>
        <span>{time.unestimated ? 'Prévu partiel' : 'Temps prévu'}</span>
        <strong>{time.planned} min</strong>
        {time.unestimated > 0 && <small>{time.unestimated} tâche(s) à estimer</small>}
      </div>
      <div>
        <span>Temps passé saisi</span>
        <strong>{time.spent} min</strong>
        <small>Somme des temps des tâches</small>
      </div>
      {time.delta !== null && (
        <p className={time.delta > 0 ? 'time-overrun' : ''}>
          {time.delta === 0
            ? 'Durée conforme au prévu'
            : `${Math.abs(time.delta)} min ${time.delta > 0 ? 'de plus' : 'de moins'} que prévu`}
        </p>
      )}
      {time.blocked > 0 && (
        <p>
          Blocages documentés : {time.blocked} min calendaires. Ces attentes sont distinctes du
          temps de travail saisi.
        </p>
      )}
      <p className="muted">
        Le temps est saisi manuellement, sans chronomètre automatique. L’écart final apparaît quand
        toutes les tâches sont estimées et terminées.
      </p>
    </section>
  );
}
