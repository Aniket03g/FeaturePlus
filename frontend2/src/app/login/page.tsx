'use client';

import { useRouter } from 'next/navigation';
import { useContext } from 'react';
import { AuthContext } from '@/context/AuthContext';

export default function Login() {

  const { login } = useContext(AuthContext);
  const router = useRouter();

  const handleLogin = () => {
    // Simulate login with mock data
    const mockUser = { id: '1', name: 'John Doe' };
    const mockProject = { id: 'p1', name: 'Project Alpha' };
    login(mockUser, mockProject);
    router.push('/');
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="bg-white p-6 rounded shadow-md">
        <h2 className="text-xl font-bold mb-4">Login</h2>
        <button onClick={handleLogin}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Try Login
        </button>
      </div>
    </div>
  );
}
