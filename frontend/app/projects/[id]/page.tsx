"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import API from "@/app/api/api";
import type { Project } from "@/app/types/project";
import styles from "./project.module.css";

const ProjectDetail = () => {
  const params = useParams();
  const id = params.id as string;
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProject = async () => {
      try {
        setLoading(true);
        const res = await API.get(`/projects/${id}`);
        setProject(res.data);
      } catch (error) {
        console.error("Failed to fetch project", error);
      } finally {
        setLoading(false);
      }
    };
    fetchProject();
  }, [id]);

  if (loading) {
    return <div className={styles.loading}>Loading project...</div>;
  }

  if (!project) {
    return <div className={styles.error}>Project not found</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.projectHeader}>
        <h1>{project.name} Overview</h1>
      </div>
      
      <div className={styles.projectOverview}>
        <div className={styles.card}>
          <h2>Project Details</h2>
          <div className={styles.cardContent}>
            <p><strong>Description:</strong> {project.description}</p>
            <p><strong>Owner:</strong> {project.owner?.username || 'Not assigned'}</p>
            <p><strong>Created:</strong> {new Date(project.created_at).toLocaleDateString()}</p>
          </div>
        </div>
        
        <div className={styles.projectActions}>
          <Link href={`/projects/${id}/board`} className={styles.actionButton}>
            View Board
          </Link>
          <Link href={`/projects/${id}/list`} className={styles.actionButton}>
            View List
          </Link>
          <Link href={`/projects/${id}/settings`} className={styles.actionButton}>
            Settings
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ProjectDetail;