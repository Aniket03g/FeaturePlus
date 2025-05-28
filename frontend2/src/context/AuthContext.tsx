"use client";
import { ReactNode, useState, createContext} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';

interface User {
  id: string;
  username: string;
  email: string;
  role: string;
  name?: string;
  // Add other user properties you expect from the backend if needed
}

interface Project {
  id: string;
  name: string;
  // Add other project properties if needed
}

// Auth context type
interface AuthContextType {
  user: User | null;
  project: Project | null;
  token: string | null; // Add token to context state
  login: (user: User, project: Project, token: string) => void; // Update login signature
  logout: () => void;
}

// Mock initial state (in a real app, this might come from an API)
export const AuthContext = createContext<AuthContextType>({
  user: null, 
  project: null, 
  token: null, // Initial state for token
  login: () => {},
  logout: () => {},
});

// Mock auth provider (simulates auth state)
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  // In a real app, use state management or API calls
  const router = useRouter();
  const pathname = usePathname(); // Get the current pathname
  const [user, setUser] = useState<User | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); // Add loading state

  // Check for token and user/project in localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedToken = localStorage.getItem('token');
      // In a real app, you would also fetch user/project data based on the token
      // For now, we'll just set the token and handle user/project in login
      setToken(storedToken);
      setLoading(false); // Set loading to false after checking localStorage
    }
  }, []);

  const login = (luser: User, lproject: Project, ltoken: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('token', ltoken);
    }
    setUser(luser); 
    setProject(lproject);
    setToken(ltoken);
  };

  const logout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
    }
    setUser(null);
    setProject(null);
    setToken(null);
    console.log('Logged out');
    router.push('/fflogin'); // Redirect to fflogin on logout
  };

  // Redirect to login if user or project is not defined and not loading
  useEffect(() => {
    // Only redirect if not loading and user or project is null
    if (!loading && (!user || !project)) {
       // Optional: check if we are already on a login/signup page to avoid infinite redirects
       if (!pathname.includes('/ffauth/') && !pathname.includes('/login') && !pathname.includes('/signup')) {
           router.push('/fflogin');
       }
    }
  }, [user, project, loading, router, pathname]); // Add pathname to dependency array

  // Optional: Add a loading indicator while checking auth state
   if (loading) {
       return <div>Loading authentication state...</div>; // Or a proper loading spinner
   }

  return (
    <AuthContext.Provider value={{ user, project, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
