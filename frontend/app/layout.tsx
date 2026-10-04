import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wayfinderr - MKV Upload Manager',
  description: 'Automatic MKV file uploader with smart server selection',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
