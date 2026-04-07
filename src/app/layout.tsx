import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vela — Agent Orchestration',
  description: 'Self-hosted agent orchestration platform built on Mastra',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
