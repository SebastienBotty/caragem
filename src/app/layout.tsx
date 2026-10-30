import type { Metadata, Viewport } from 'next';
import './globals.css';
import './theme.css';

export const metadata: Metadata = {
  title: 'CaRM — Votre garage, en mouvement',
  description:
    'Le garage visuel et collaboratif. Véhicules, interventions, équipe et gestion dans un même espace.',
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f5f6f8',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
