"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import API from "@/app/api/api";
import styles from '@/app/styles/Form.module.css';

const EditUser = () => {
  const router = useRouter();
  const { id } = useParams();
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    role: 'user'
  });

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await API.get(`/users/${id}`);
        setFormData({
          email: res.data.email,
          username: res.data.username,
          role: res.data.role
        });
      } catch (error) {
        console.error("Failed to fetch user", error);
        alert('Failed to load user data');
      }
    };
    fetchUser();
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await API.put(`/users/${id}`, formData);
      router.push("/");
      alert('User updated successfully!');
    } catch (error) {
      console.error("Update failed:", error);
      alert('Failed to update user');
    }
  };

  return (
    <div className={styles.formContainer}>
      <h1>Edit User</h1>
      <form onSubmit={handleSubmit} className="card">
        <div className={styles.formGroup}>
          <label>Email:</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
          />
        </div>
        
        <div className={styles.formGroup}>
          <label>Username:</label>
          <input
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            required
          />
        </div>

        <div className={styles.formGroup}>
          <label>Role:</label>
          <select
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
          </select>
        </div>

        <div className={styles.formActions}>
          <button type="submit" className={styles.primaryButton}>
            Save Changes
          </button>
          <button
            type="button"
            onClick={() => router.push("/")}
            className={styles.secondaryButton}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default EditUser;