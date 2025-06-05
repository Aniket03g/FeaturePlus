"use client";

import { ReactNode, useState, createContext} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import API from "@/api/api";

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
  token: string | null; // Add token to context state
  authInfo: AuthInfo | null;
  project: Project | null;
  registerCredentials: (authInfo: AuthInfo, project: Project, token: string) => void; // Update login signature
  forgetCredentials: () => void;
  verifyCredentials: () => void;
}

// Mock initial state (in a real app, this might come from an API)
export const AuthContext = createContext<AuthContextType>({
  token: null, // Server provided token 
  authInfo: null, 
  project: null, 
  registerCredentials: () => {},
  forgetCredentials: () => {},
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

  // Using only info stored in page. (token in localstorage only if user closes browser and comes back later. 
  useEffect( () => {
    console.log("AuthProvider called for path:", pathname);
    setLoading(true); // Set loading to false after checking localStorage
    console.log("AuthProvider: useEffect: Retrieving from localStorage()"); 
    const l_token=localStorage.getItem('token');
    const l_authInfo=localStorage.getItem('authInfo');
    const l_project=localStorage.getItem('project');
    setToken(l_token);
    setAuthInfo(l_authInfo);
    setProject(l_project);
    setLoading(false); // Set loading to false after checking localStorage
    console.log("AuthProvider: useEffect (pageload): token=", token, " AuthInfo=", authInfo); 
    console.log("AuthProvider: Fetched:", l_token, l_authInfo, l_project); 
    /* We can't assume token etc. are set here. Use local variables. */ 
    if ( !l_token ) {
      console.log("AuthProvider: Loggin in, token is nil."); 
      router.push('/fflogin');
    } 
  }, []); 

  const registerCredentials = (l_authInfo: AuthInfo, l_project: Project, l_token: string) => {
    console.log("AuthProvider: registerCredentials: Adding to localStorage()"); 
    localStorage.setItem('token', l_token);
    localStorage.setItem('authInfo', l_authInfo);
    localStorage.setItem('project', l_project);
    setToken(l_token);
    setAuthInfo(l_authInfo); 
    setProject(l_project);
    console.log("In registerCredentials: Saved authInfo", authInfo, " project=", project, " token=", token);
  };

  const forgetCredentials = () => {
    console.log("AuthProvider: forgetCredentials: cleaning up localStorage");
    localStorage.removeItem('token');
    localStorage.removeItem('authInfo');
    localStorage.removeItem('project');
    setAuthInfo(null);
    setProject(null);
    setToken(null);
    API.get('/logout');
    console.log('AuthContext: Removed credentials.');
  };

  const verifyCredentials = () => {
    const l_token=localStorage.getItem('token');
    const l_authInfo=localStorage.getItem('authInfo');
    const l_project=localStorage.getItem('project');
    console.log("AuthContext: verifyCredentials:", l_authInfo, l_project, l_token);
  }


  // Optional: Add a loading indicator while checking auth state
   if (loading) {
       return <div>Loading authentication state...</div>; // Or a proper loading spinner
   }

  return (
    <AuthContext.Provider value={{ token, authInfo, project, registerCredentials, forgetCredentials, verifyCredentials}}>
      {children}
    </AuthContext.Provider>
  );
};
