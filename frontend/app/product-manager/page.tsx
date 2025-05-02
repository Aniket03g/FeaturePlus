"use client";
import React, { useEffect, useState } from "react";
import API from "@/app/api/api";
import { Feature, User, Project } from "@/app/types";
import styles from "../features/list/FeatureList.module.css";

const ProductManagerPage = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [formData, setFormData] = useState<Omit<Feature, 'id' | 'created_at' | 'updated_at'>>({
    project_id: 0,
    title: "",
    description: "",
    status: "todo",
    priority: "medium",
    assignee_id: 0,
    tag: "p2",
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [usersRes, projectsRes] = await Promise.all([
          API.get("/users"),
          API.get("/projects"),
        ]);
        setUsers(usersRes.data);
        setProjects(projectsRes.data);
      } catch (err) {
        setError("Failed to load users or projects");
      }
    };
    fetchData();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: name === "assignee_id" || name === "project_id" ? Number(value) : value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSuccess("");
    setError("");
    try {
      await API.post("/features", formData);
      setSuccess("Feature created successfully!");
      setFormData({
        project_id: 0,
        title: "",
        description: "",
        status: "todo",
        priority: "medium",
        assignee_id: 0,
        tag: "p2",
      });
    } catch (err) {
      setError("Failed to create feature");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.pageWrapper} style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#f8fafc' }}>
      <div className={styles.modal} style={{ animation: 'fadeIn 0.7s', maxWidth: 500, width: '100%', boxShadow: '0 8px 32px rgba(31,41,55,0.12)', borderRadius: 16, background: '#fff', padding: 32 }}>
        <div className={styles.modalHeader} style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#3730a3', letterSpacing: '-0.5px' }}>Create Feature (Product Manager)</h3>
        </div>
        <form onSubmit={handleSubmit} className={styles.form} autoComplete="off">
          <div className={styles.formGroup}>
            <label>Project</label>
            <select name="project_id" value={formData.project_id} onChange={handleChange} required className={styles.formInput} style={{ borderRadius: 8 }}>
              <option value="">Select a project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </div>
          <div className={styles.formGroup}>
            <label>Title</label>
            <input name="title" value={formData.title} onChange={handleChange} required className={styles.formInput} style={{ borderRadius: 8 }} />
          </div>
          <div className={styles.formGroup}>
            <label>Description</label>
            <textarea name="description" value={formData.description} onChange={handleChange} className={styles.formInput} style={{ borderRadius: 8, minHeight: 80 }} />
          </div>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>Status</label>
              <select name="status" value={formData.status} onChange={handleChange} className={styles.formInput} style={{ borderRadius: 8 }}>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div className={styles.formGroup}>
              <label>Priority</label>
              <select name="priority" value={formData.priority} onChange={handleChange} className={styles.formInput} style={{ borderRadius: 8 }}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <div className={styles.formGroup}>
            <label>Assignee</label>
            <select name="assignee_id" value={formData.assignee_id} onChange={handleChange} className={styles.formInput} style={{ borderRadius: 8 }}>
              <option value={0}>Unassigned</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.username}</option>
              ))}
            </select>
          </div>
          <div className={styles.formGroup}>
            <label>Tag</label>
            <select name="tag" value={formData.tag} onChange={handleChange} className={formData.tag === 'p0' ? styles.tagP0 : formData.tag === 'p1' ? styles.tagP1 : styles.tagP2} style={{ borderRadius: 8, fontWeight: 600 }}>
              <option value="p0">P0 (Critical)</option>
              <option value="p1">P1 (High)</option>
              <option value="p2">P2 (Normal)</option>
            </select>
          </div>
          <div className={styles.formActions} style={{ marginTop: 24 }}>
            <button type="submit" className={styles.saveButton} style={{ borderRadius: 8, fontWeight: 600, fontSize: '1rem', transition: 'background 0.2s, transform 0.2s' }} disabled={loading}>
              {loading ? <span className={styles.loadingIndicator} style={{ marginRight: 8 }} /> : null}
              {loading ? "Creating..." : "Create Feature"}
            </button>
          </div>
          {success && <div style={{ color: "#059669", marginTop: 16, fontWeight: 500, textAlign: 'center', transition: 'opacity 0.3s' }}>{success}</div>}
          {error && <div style={{ color: "#dc2626", marginTop: 16, fontWeight: 500, textAlign: 'center', transition: 'opacity 0.3s' }}>{error}</div>}
        </form>
      </div>
      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default ProductManagerPage; 