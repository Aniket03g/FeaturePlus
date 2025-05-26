"use client";
import { useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import API from "@/api/api";
import FeatureBoard from "./FeatureBoard";
import type { Project } from "@/app/types/project";
import styles from "./project.module.css";
import Link from 'next/link';

const ProjectBoardPage = () => {
  const params = useParams();
  const projectId = params.projectId as string;
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProject = useCallback(async () => {
    try {
      setLoading(true);
      const res = await API.get(`/projects/${projectId}`);
      setProject(res.data);
    } catch (error) {
      console.error("Failed to fetch project", error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProject();
  }, [projectId, fetchProject]);

  if (loading) {
    return <div className={styles.loading}>Loading project...</div>;
  }

  if (!project) {
    return <div className={styles.error}>Project not found</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.projectHeader}>
        <h1>{project.name} Board</h1>
      </div>
      <FeatureBoard projectId={projectId} project={project} onFeatureUpdated={fetchProject} />
    </div>
  );
};

export default ProjectBoardPage;
