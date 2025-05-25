"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import API from '@/api/api';
import type { Project } from '@/types/project';
import ProjectCard from './ProjectCard';
import styles from './Projects.module.css';

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        setLoading(true);
        const response = await API.get('/projects');
        setProjects(response.data);
      } catch (err) {
        console.error('Error fetching projects:', err);
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
