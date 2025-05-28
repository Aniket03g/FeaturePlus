"use client";

import { ReactNode, useState, createContext} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';

interface AuthInfo {
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
  authInfo: AuthInfo | null;
  project: Project | null;
  token: string | null; // Add token to context state
  registerCredentials: (authInfo: AuthInfo, project: Project, token: string) => void; // Update login signature
  logout: () => void;
}

// Mock initial state (in a real app, this might come from an API)
export const AuthContext = createContext<AuthContextType>({
  authInfo: null, 
  project: null, 
  token: null, // Initial state for token
  registerCredentials: () => {},
  logout: () => {},
});

// Mock auth provider (simulates auth state)
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  // In a real app, use state management or API calls
  const router = useRouter();
  const pathname = usePathname(); // Get the current pathname
  const [authInfo, setAuthInfo] = useState<AuthInfo | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); // Add loading state

  // Check for token and user/project in localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    setToken(storedToken); 
    console.log("Token in authProvider.", storedToken);
    setLoading(false); // Set loading to false after checking localStorage
    // Only redirect if not loading and user or project is null
    if (token == null) { 
       // Optional: check if we are already on a login/signup page to avoid infinite redirects
       if (!pathname.includes('/ffauth/') && !pathname.includes('/login') && !pathname.includes('/signup')) {
           router.push('/fflogin');
       }
    }
  }, [authInfo, project, loading, router, pathname]); 

  const registerCredentials = (l_authInfo: AuthInfo, l_project: Project, l_token: string) => {
    localStorage.setItem('token', l_token);
    console.log("Logged in successfully: registering token:", l_token);
    setToken(l_token);
    console.log("In registerCredentials: authInfo", l_authInfo, " project=", l_project);
    setAuthInfo(l_authInfo); 
    setProject(l_project);
  };

  const logout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
    }
    setAuthInfo(null);
    setProject(null);
    setToken(null);
    console.log('Logged out');
    router.push('/fflogin'); // Redirect to fflogin on logout
  };

  // Optional: Add a loading indicator while checking auth state
   if (loading) {
       return <div>Loading authentication state...</div>; // Or a proper loading spinner
   }

  return (
    <AuthContext.Provider value={{ authInfo, project, token, registerCredentials, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
