"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import API from "@/api/api";
import styles from './page.module.css';


interface User {
  id: number;
  email: string;
  username: string;
  role: string;
}

const Home = () => {
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
