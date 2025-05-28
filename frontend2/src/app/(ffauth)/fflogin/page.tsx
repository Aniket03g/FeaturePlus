"use client";

import { useState, useEffect, useContext } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
// import API from '@/app/api/api';
import API from '@/api/api';
import styles from './page.module.css';
import { AuthContext } from '@/context/AuthContext';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [credentials, setCredentials] = useState({
    email: '',
    password: ''
  });
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { registerCredentials } = useContext(AuthContext); // Get the login function from AuthContext

  // Check for registered=true parameter
  useEffect(() => {
    if (!searchParams) return;
    
    const registered = searchParams.get('registered');
    if (registered === 'true') {
      setSuccessMessage('Your account has been created successfully. Please log in.');
    }
  }, [searchParams]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setCredentials({
      ...credentials,
      [name]: value
    });
    
    // Clear error when user starts typing again
    if (error) {
      setError(null);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    console.log("login: Trying to login. Credentials:", credentials);

    if (!credentials.email || !credentials.password) {
      setError("Email and password are required");
      setLoading(false);
      return;
    }

    try {
      const response = await API.post('/auth/login', credentials);
      const { token, auth_info, projects_roles } = response.data; // Assuming backend returns token, user, and projects_roles
      
      // Create a dummy project object or use a real one if available in the response
      const project = { id: 'dummy-project-id', name: 'Dummy Project' }; // Replace with actual project logic if needed

      // Use the login function from AuthContext
      registerCredentials(auth_info, project, token);
      
      // Redirect to homepage after successful login
      router.push('/');
      
      // The AuthContext useEffect will handle the redirect

    } catch (error: any) {
      console.error('Login failed:', error);
      if (error.response?.status === 401) {
        setError('Invalid email or password. Please try again.');
      } else {
        setError(error.response?.data?.error || 'Login failed. Please check your credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.loginCard}>
        <h1 className={styles.title}>Log In</h1>
        
        {successMessage && (
          <div className={styles.successMessage}>{successMessage}</div>
        )}
        
        {error && <div className={styles.errorMessage}>{error}</div>}
        
        <form onSubmit={handleLogin} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="email" className={styles.label}>Email</label>
            <input
              type="email"
              id="email"
              name="email"
              value={credentials.email}
              onChange={handleInputChange}
              className={styles.input}
              required
              placeholder="Enter your email"
            />
          </div>
          
          <div className={styles.formGroup}>
            <label htmlFor="password" className={styles.label}>Password</label>
            <input
              type="password"
              id="password"
              name="password"
              value={credentials.password}
              onChange={handleInputChange}
              className={styles.input}
              required
              placeholder="Enter your password"
            />
          </div>
          
          <button 
            type="submit" 
            className={styles.loginButton}
            disabled={loading}
          >
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>
        
        <div className={styles.signup}>
          Don't have an account?{' '}
          <Link href="/signup" className={styles.signupLink}>
            Sign up
          </Link>
        </div>

        <div className={styles.passwordReset}>
          <small>
            Having trouble logging in? Use the default password: <code>password123</code> for existing accounts.
          </small>
        </div>
      </div>
    </div>
  );
} 
