import './globals.css';
import React from 'react';

export const metadata = {
  title: 'Tier List 2D – Rap FR',
  description: 'Tier list 2D avec lignes/colonnes personnalisables, import JSON et images, et partage via URL.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head><meta charSet="utf-8" /></head>
      <body>{children}</body>
    </html>
  );
}
