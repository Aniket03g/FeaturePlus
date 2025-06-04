'use client';

import { useEffect, useState, useContext } from 'react';
import { AuthContext } from '@/context/AuthContext';
import Link from "next/link";
import API from "@/api/api";
import styles from './page.module.css';
import { useRouter } from 'next/navigation';

interface User {
  id: number;
  email: string;
  username: string;
  role: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
}

const Home = () => {
  const { authInfo, project, logout } = useContext(AuthContext);
  console.log("From authcontext:", authInfo, project);  
  const router=useRouter();

  useEffect(()=> {
    if (authInfo) {
       router.push("/projects");
    }
  }, [authInfo]);

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Welcome to the App</h1>
      {authInfo? (
        <>
          <p className="text-lg">User: {authInfo.username || authInfo.name}</p>
          <p className="text-lg">Project: {project?.name || 'No project selected'}</p>
          <button onClick={logout} className="mt-4 px-4 py-2 bg-red-500 text-white rounded">Logout</button>
        </>
      ) : (
        <> 
          <p className="text-lg">Please log in.</p>
          <div><Link href="/fflogin"> Login </Link></div>
          <button onClick={logout} className="mt-4 px-4 py-2 bg-red-500 text-white rounded">Logout</button>
        </>
      )}
      
    </div>
  );
}

const Home2 = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await API.get("/users");
        setUsers(res.data);
        setError("");
      } catch (error) {
        console.error("Failed to fetch users", error);
        setError("Failed to load users. Please try again later.");
      } finally {
        setLoading(false);
      }
    };
    fetchUsers();
  }, []);

  const handleDelete = async (id: number) => {
    if (window.confirm("Are you sure you want to delete this user?")) {
      try {
        await API.delete(`/users/${id}`);
        setUsers(users.filter((user) => user.id !== id));
      } catch (error) {
        console.error("Failed to delete user", error);
        alert("Failed to delete user");
      }
    }
  };

  if (loading) {
    return <div className={styles.loading}>Loading users...</div>;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Dashboard </h1>
      </div>
      <div className={styles.emptyState}>This will be our dashboard later. </div>
    </div>
  );
};

export default Home;

