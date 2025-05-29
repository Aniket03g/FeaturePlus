"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import API from '@/api/api';
import type { Project } from '@/types/project';
import ProjectCard from './ProjectCard';
import styles from './Projects.module.css';
import { useRouter } from 'next/navigation';

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        setLoading(true);
        const response = await API.get('/projects');
        setProjects(response.data);
      } catch (err: any) {
        console.error('Error fetching projects:', err);
        setProjects([]);
        if (err.response?.status === 401) {
          // Redirect to login if unauthorized
          router.push('/fflogin');
          return;
        }
        setError('Failed to load projects. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, []);

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner}></div>
        <p>Loading projects...</p>
      </div>
    );
  }

  if (error) {
    return <div className={styles.errorContainer}>{error}</div>;
  }

  // Add a check to ensure projects is an array before attempting to map
  if (!Array.isArray(projects)) {
      console.error("Projects state is not an array:", projects);
      // We expect a redirect on 401, but this prevents errors in other unexpected cases
      return <div className={styles.errorContainer}>An unexpected error occurred loading projects.</div>; // Fallback UI
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Projects</h1>
        <Link href="/projects/create" className={styles.createButton}>
          <span className={styles.plusIcon}>+</span>
          Create New Project
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📁</div>
          <h2 className={styles.emptyTitle}>No projects found</h2>
          <p className={styles.emptyMessage}>Get started by creating your first project</p>
          <Link href="/projects/create" className={styles.emptyButton}>
            Create Project
          </Link>
        </div>
      ) : (
        <div className={styles.grid}>
          {projects.map((project) => (
            <div className={styles.cardWrapper} key={project.id}>
              <ProjectCard project={project} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
