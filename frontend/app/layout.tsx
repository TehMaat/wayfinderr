import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AppShell } from '@/components/app-shell';
import { AuthGate } from '@/components/auth-gate';
import { ACCENTS, DEFAULT_ACCENT } from '@/lib/accents';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Wayfinderr',
  description: 'Automatic MKV uploader with smart server selection',
  icons: { icon: { url: `/icons/${DEFAULT_ACCENT}.svg`, type: 'image/svg+xml' } },
};

// Applies the saved theme (dark by default) and accent before the first paint; the
// tab icon follows the accent once the page is parsed
const themeScript =
  "try{var r=document.documentElement;if(localStorage.getItem('theme')==='light')r.classList.remove('dark');" +
  `var a=localStorage.getItem('accent');if(${JSON.stringify(ACCENTS.map((a) => a.id).filter((id) => id !== DEFAULT_ACCENT))}.indexOf(a)>=0){r.dataset.accent=a;` +
  "document.addEventListener('DOMContentLoaded',function(){document.querySelectorAll('link[rel=\"icon\"]').forEach(function(l){l.href='/icons/'+a+'.svg'})})}}catch(e){}";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable}`} data-accent={DEFAULT_ACCENT} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">
        <AuthGate>
          <AppShell>{children}</AppShell>
        </AuthGate>
      </body>
    </html>
  );
}
