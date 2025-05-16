"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import API from '@/app/api/api';
import styles from './Navbar.module.css';

interface UserData {
  id: number;
  username: string;
  email: string;
  role: string;
}

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Check if user is logged in on component mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          setUser(null);
          setLoading(false);
          return;
        }
        
        // Try to get user data from localStorage (for faster UI)
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          setUser(JSON.parse(storedUser));
        }
        
        // Always validate with the server
        try {
          // Use API client instead of fetch
          const response = await API.get('/auth/me');
          const userData = response.data;
          setUser(userData);
          localStorage.setItem('user', JSON.stringify(userData));
        } catch (error) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setUser(null);
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    
    checkAuth();
  }, []);
  
  const isActive = (path: string) => {
    return pathname === path || pathname?.startsWith(`${path}/`);
  };

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };
  
  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
    router.push('/login');
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
          {!loading && (
            user ? (
              <div className={styles.userDropdown}>
                <button className={styles.userButton}>
                  <span className={styles.avatar}>{user.username?.charAt(0) || 'U'}</span>
                  <span className={styles.username}>{user.username}</span>
                </button>
                <div className={styles.dropdownMenu}>
                  <div className={styles.dropdownUserInfo}>
                    <span className={styles.dropdownUsername}>{user.username}</span>
                    <span className={styles.dropdownEmail}>{user.email}</span>
                    <span className={styles.dropdownRole}>{user.role}</span>
                  </div>
                  <div className={styles.dropdownDivider}></div>
                  <button 
                    className={styles.logoutButton}
                    onClick={handleLogout}
                  >
                    Log Out
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.authButtons}>
                <Link 
                  href="/login" 
                  className={styles.loginButton}
                >
                  Log In
                </Link>
                <Link 
                  href="/signup" 
                  className={styles.signupButton}
                >
                  Sign Up
                </Link>
              </div>
            )
          )}
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