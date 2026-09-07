import type { Metadata } from 'next';
import './globals.css';
import 'leaflet/dist/leaflet.css';

export const viewport={width:'device-width',initialScale:1,viewportFit:'cover'};

export const metadata: Metadata = {
  title: 'Street Racer — твои улицы',
  description: 'Свободная езда и уличные гонки по реальной карте.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru" className="dark"><body>{children}</body></html>;
}
