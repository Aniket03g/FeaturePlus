"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import API from "@/app/api/api";
import { User } from "@/app/types";
import type { Project } from "@/app/types/project";
import styles from "../project.module.css";
import formStyles from "../../../create-users/page.module.css";

const ProjectSettingsPage = () => {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [project, setProject] = useState<Project | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    owner_id: 0,
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [projectRes, usersRes] = await Promise.all([
          API.get(`/projects/${id}`),
          API.get("/users"),
        ]);
        setProject(projectRes.data);
        setUsers(usersRes.data);
        setFormData({
          name: projectRes.data.name,
          description: projectRes.data.description,
          owner_id: projectRes.data.owner_id,
        });
      } catch (error) {
        console.error("Failed to fetch data", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: name === "owner_id" ? Number(value) : value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await API.put(`/projects/${id}`, formData);
      alert("Project updated successfully");
      router.refresh();
    } catch (error) {
      console.error("Failed to update project", error);
      alert("Failed to update project");
    }
  };

  const handleDelete = async () => {
    if (window.confirm("Are you sure you want to delete this project?")) {
      try {
        await API.delete(`/projects/${id}`);
        alert("Project deleted successfully");
        router.push("/projects");
      } catch (error) {
        console.error("Failed to delete project", error);
        alert("Failed to delete project");
      }
    }
  };

  if (loading) {
    return <div className={styles.loading}>Loading project...</div>;
  }

  if (!project) {
    return <div className={styles.error}>Project not found</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.projectHeader}>
        <h1>{project.name} Settings</h1>
      </div>

      <div className={styles.settingsForm}>
        <form onSubmit={handleSubmit}>
          <div className={formStyles.formGroup}>
            <label htmlFor="name">Project Name</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
            />
          </div>

          <div className={formStyles.formGroup}>
            <label htmlFor="description">Description</label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              rows={4}
            />
          </div>

          <div className={formStyles.formGroup}>
            <label htmlFor="owner_id">Owner</label>
            <select
              id="owner_id"
              name="owner_id"
              value={formData.owner_id}
              onChange={handleChange}
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.username}
                </option>
              ))}
            </select>
          </div>

          <div className={formStyles.formActions}>
            <button type="submit" className={formStyles.primaryButton}>
              Save Changes
            </button>
          </div>
        </form>

        <div className={styles.dangerZone}>
          <h2>Danger Zone</h2>
          <p>
            Once you delete a project, there is no going back. Please be certain.
          </p>
          <button
            onClick={handleDelete}
            className={formStyles.dangerButton}
          >
            Delete Project
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectSettingsPage; 