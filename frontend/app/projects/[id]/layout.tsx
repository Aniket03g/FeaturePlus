"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar from "@/app/components/Sidebar";
import API from "@/app/api/api";
import type { Project } from "@/app/types/project";
import styles from "@/app/layout.module.css";

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const id = params.id as string;
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    const fetchProject = async () => {
      try {
        const res = await API.get(`/projects/${id}`);
        setProject(res.data);
      } catch (error) {
        console.error("Failed to fetch project", error);
      }
    };
    fetchProject();
  }, [id]);

  return (
    <div className={styles.container}>
      <Sidebar projectId={id} projectName={project?.name} />
      <main className={styles.mainContent}>{children}</main>
    </div>
  );
} 