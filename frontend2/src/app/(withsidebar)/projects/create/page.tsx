"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import API from "@/api/api";
import styles from './page.module.css';

const CreateProjectPage = () => {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    owner_id: ""
  });

  const handleCreate = async () => {
    // Validate required fields
    if (!formData.name.trim() || !formData.owner_id) {
      alert("Project name and owner ID are required");
      return;
    }

    try {
      const payload = {
        ...formData,
        owner_id: Number(formData.owner_id) // Convert to number
      };

      await API.post("/projects", payload);
      router.push("/projects");
    } catch (error: unknown) {
      const errorResponse = error as { response?: { data?: { error?: string } } };
      console.error("Failed to create project:", errorResponse.response?.data);
      alert(`Error: ${errorResponse.response?.data?.error || "Failed to create project"}`);
    }
  };

  return (
    <div className={styles.formContainer}>
      <h1>Create Project</h1>
      <div className={styles.card}>
        <div className={styles.formGroup}>
          <label className={styles.label}>Name:</label>
          <input
            className={styles.input}
            value={formData.name}
            onChange={(e) => setFormData({...formData, name: e.target.value})}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>Description:</label>
          <textarea
            className={styles.input}
            value={formData.description}
            onChange={(e) => setFormData({...formData, description: e.target.value})}
          />
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>Owner ID:</label>
          <input
            className={styles.input}
            type="number"
            value={formData.owner_id}
            onChange={(e) => setFormData({...formData, owner_id: e.target.value})}
            required
          />
        </div>
        <div className={styles.formActions}>
          <button
            onClick={handleCreate}
            className={styles.primaryButton}
          >
            Create Project
          </button>
          <button
            onClick={() => router.push("/projects")}
            className={styles.secondaryButton}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateProjectPage;
