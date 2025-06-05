"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import API from "@/app/api/api";
import styles from './page.module.css';

const CreateUserPage = () => { // Changed component name
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: "",
    username: "",
    password: "",
    role: "user" // Added user-specific fields
  });

  const handleCreate = async () => {
    try {
      await API.post("/users", formData);
      router.push("/"); // Redirect to home
    } catch (error) {
      console.error("Failed to create user", error);
      alert("Failed to create user");
    }
  };

  return (
    <div className={styles.formContainer}>
      <h1>Create User</h1> {/* Changed title */}
      <div className={styles.card}>
        <div className={styles.formGroup}>
          <label className={styles.label}>Email:</label>
          <input
            className={styles.input}
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({...formData, email: e.target.value})}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>Username:</label>
          <input
            className={styles.input}
            value={formData.username}
            onChange={(e) => setFormData({...formData, username: e.target.value})}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>Password:</label>
          <input
            className={styles.input}
            type="password"
            value={formData.password}
            onChange={(e) => setFormData({...formData, password: e.target.value})}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>Role:</label>
          <select
            className={styles.input}
            value={formData.role}
            onChange={(e) => setFormData({...formData, role: e.target.value})}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className={styles.formActions}>
          <button
            onClick={handleCreate}
            className={styles.primaryButton}
          >
            Create User {/* Changed button text */}
          </button>
          <button
            onClick={() => router.push("/")}
            className={styles.secondaryButton}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateUserPage; // Corrected export name