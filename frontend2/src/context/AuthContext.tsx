"use client";
import { ReactNode, useState, createContext} from 'react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

interface User {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
}

// Auth context type
interface AuthContextType {
  user: User | null;
  project: Project | null;
  login: (user: User, project: Project) => void;
  logout: () => void;
}

// Mock initial state (in a real app, this might come from an API)
export const AuthContext = createContext<AuthContextType>({
  user: null, 
  project: null, 
  login: () => {},
  logout: () => {},
});

// Mock auth provider (simulates auth state)
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  // In a real app, use state management or API calls
  const router = useRouter();
  const [user, setUser] = useState<User>(null);
  const [project, setProject] = useState<Project>(null);

  const login = (luser: User, lproject: Project) => {
    // In a real app, update state or call API
    setUser(luser); 
    setProject(lproject);
  };

  const logout = () => {
    // In a real app, clear state or call API
    console.log('Logged out');
  };

  // Redirect to login if user or project is not defined
  useEffect(() => {
    if (!user || !project) {
      router.push('/login');
    } else {
      console.log("In useEffect user not null:", user, project);
    }

  }, [user, project]);

  return (
    <AuthContext.Provider value={{ user, project, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
