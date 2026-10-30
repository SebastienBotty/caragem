'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowDown, ArrowUpRight, Layers3 } from 'lucide-react';
import './landing-page.css';

const LandingDemo = dynamic(() => import('./landing-demo'), {
  ssr: false,
  loading: () => <div className="landing-loading">Ouverture de l’atelier 3D…</div>,
});

export function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <Link href="/decouvrir" className="landing-brand">
          <Layers3 size={27} /> Caragem.
        </Link>
        <nav>
          <a href="#histoire">Comment ça marche</a>
          <Link href="/" className="button primary">
            Ouvrir Caragem <ArrowUpRight size={16} />
          </Link>
        </nav>
      </header>
      <main>
        <section className="landing-intro">
          <div>
            <p className="landing-eyebrow">LE GARAGE VISUEL ET COLLABORATIF</p>
            <h1>
              Votre atelier.
              <br />
              <span>En mouvement.</span>
            </h1>
          </div>
          <div>
            <p>
              Des clients aux pièces détachées, chaque action trouve sa place. Découvrez une journée
              dans Caragem, au cœur de votre garage.
            </p>
            <a href="#histoire" className="button primary">
              Suivre une intervention <ArrowDown size={17} />
            </a>
          </div>
        </section>
        <LandingDemo />
      </main>
      <footer className="landing-footer">
        <span className="landing-brand">Caragem.</span>
        <span>Clients · Véhicules · Équipe · Stock</span>
        <Link href="/">Accéder à mon garage ↗</Link>
      </footer>
    </div>
  );
}
