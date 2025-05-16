"use client";
import { useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import API from "@/app/api/api";
import FeatureList from "@/app/features/list";
import type { Project } from "@/app/types/project";
import styles from "../project.module.css";

const ProjectListPage = () => {
  const params = useParams();
  const id = params.id as string;
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProject = useCallback(async () => {
    try {
      setLoading(true);
      const res = await API.get(`/projects/${id}`);
      setProject(res.data);
    } catch (error) {
      console.error("Failed to fetch project", error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProject();
  }, [id, fetchProject]);

  if (loading) {
    return <div className={styles.loading}>Loading project...</div>;
  }

  if (!project) {
    return <div className={styles.error}>Project not found</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.projectHeader}>
        <h1>{project.name} Feature Groups</h1>
      </div>
      <div className={styles.projectContent}>
        <FeatureList projectId={id} onFeatureUpdated={fetchProject} />
      </div>
    </div>
  );
};

export default ProjectListPage; 