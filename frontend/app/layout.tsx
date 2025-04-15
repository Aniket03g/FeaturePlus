import './globals.css';
import type { Metadata } from 'next';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import styles from './layout.module.css';

export const metadata: Metadata = {
  title: 'FeaturePlus',
  description: 'Feature management for teams',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={styles.body}>
        <Navbar />
        <div className={styles.container}>
          <Sidebar />
          <main className={styles.mainContent}>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}