import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Stock Scanner',
  description: 'Compare fundamentals across a watchlist of tickers. Not investment advice.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
