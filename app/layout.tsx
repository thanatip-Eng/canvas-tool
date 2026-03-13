import type { Metadata } from 'next';
import { Space_Grotesk, Sarabun } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
});

const sarabun = Sarabun({
  weight: ['300', '400', '600', '700'],
  subsets: ['thai', 'latin'],
  variable: '--font-thai',
});

export const metadata: Metadata = {
  title: 'Canvas Tools',
  description: 'เครื่องมือจัดการข้อมูล Canvas LMS สำหรับอาจารย์',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body className={`${spaceGrotesk.variable} ${sarabun.variable} antialiased`}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
