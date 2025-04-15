"use client";
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Navbar.module.css';

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const pathname = usePathname();
  
  const isActive = (path: string) => {
    return pathname === path || pathname?.startsWith(`${path}/`);
  };

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  return (
    <nav className={styles.navbar}>
      <div className={styles.container}>
        <div className={styles.logoSection}>
          <Link href="/" className={styles.logo}>
            <span className={styles.logoIcon}>✨</span>
            <span className={styles.logoText}>FeaturePlus</span>
          </Link>
        </div>
        
        <div className={`${styles.navSection} ${isMenuOpen ? styles.menuActive : ''}`}>
          <Link 
            href="/projects" 
            className={`${styles.navItem} ${isActive('/projects') ? styles.active : ''}`}
            onClick={() => setIsMenuOpen(false)}
          >
            <span className={styles.navIcon}>📋</span>
            Projects
          </Link>
          <Link 
            href="/create-project" 
            className={`${styles.navItem} ${isActive('/create-project') ? styles.active : ''}`}
            onClick={() => setIsMenuOpen(false)}
          >
            <span className={styles.navIcon}>➕</span>
            New Project
          </Link>
        </div>
        
        <div className={styles.userSection}>
          <Link 
            href="#" 
            className={styles.userButton}
            onClick={() => setIsMenuOpen(false)}
          >
            <span className={styles.avatar}>U</span>
            <span className={styles.username}>User</span>
          </Link>
        </div>
        
        <button 
          className={styles.menuButton} 
          onClick={toggleMenu}
          aria-label="Toggle menu"
        >
          <div className={`${styles.menuIcon} ${isMenuOpen ? styles.menuOpen : ''}`}>
            <span></span>
            <span></span>
            <span></span>
          </div>
        </button>
      </div>
    </nav>
  );
};

export default Navbar; 