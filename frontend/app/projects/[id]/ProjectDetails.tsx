"use client";
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import API from '@/app/api/api';
import type { Project } from '@/app/types/project';
import styles from './ProjectDetails.module.css';

interface ProjectDetailsProps {
  projectId: string;
}

const ProjectDetails = ({ projectId }: ProjectDetailsProps) => {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchProject = async () => {
      try {
        setLoading(true);
        const response = await API.get(`/projects/${projectId}`);
        setProject(response.data);
      } catch (err) {
        console.error('Error fetching project details:', err);
        setError('Failed to load project details. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchProject();
  }, [projectId]);

  const handleDeleteProject = async () => {
    if (window.confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
      try {
        await API.delete(`/projects/${projectId}`);
        router.push('/projects');
      } catch (err) {
        console.error('Error deleting project:', err);
        alert('Failed to delete project. Please try again later.');
      }
    }
  };

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner}></div>
        <p>Loading project details...</p>
      </div>
    );
  }

  if (error) {
    return <div className={styles.errorContainer}>{error}</div>;
  }

  if (!project) {
    return <div className={styles.errorContainer}>Project not found</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <h1 className={styles.title}>{project.name}</h1>
          <span className={styles.projectId}>Project #{project.id}</span>
        </div>
        <div className={styles.actions}>
          <Link href={`/projects/${projectId}/board`} className={styles.viewButton}>
            <span className={styles.viewIcon}>📊</span>
            View Board
          </Link>
          <Link href={`/projects/${projectId}/list`} className={styles.viewButton}>
            <span className={styles.viewIcon}>📋</span>
            View List
          </Link>
          <button className={styles.deleteButton} onClick={handleDeleteProject}>
            <span className={styles.deleteIcon}>🗑️</span>
            Delete
          </button>
        </div>
      </div>

      <div className={styles.infoCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Project Information</h2>
        </div>
        <div className={styles.cardContent}>
          <div className={styles.infoRow}>
            <div className={styles.infoLabel}>Description</div>
            <div className={styles.infoValue}>
              {project.description || <span className={styles.noInfo}>No description provided</span>}
            </div>
          </div>
          <div className={styles.infoRow}>
            <div className={styles.infoLabel}>Status</div>
            <div className={styles.infoValue}>
              <span className={`${styles.statusBadge} ${project.status ? styles[project.status] : ''}`}>
                {project.status ? project.status.charAt(0).toUpperCase() + project.status.slice(1) : 'Unknown'}
              </span>
            </div>
          </div>
          <div className={styles.infoRow}>
            <div className={styles.infoLabel}>Created</div>
            <div className={styles.infoValue}>
              {new Date(project.created_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </div>
          </div>
          <div className={styles.infoRow}>
            <div className={styles.infoLabel}>Updated</div>
            <div className={styles.infoValue}>
              {new Date(project.updated_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </div>
          </div>
          <div className={styles.infoRow}>
            <div className={styles.infoLabel}>Owner</div>
            <div className={styles.infoValue}>
              <div className={styles.ownerInfo}>
                <span className={styles.avatarCircle}>
                  {project.user?.username?.charAt(0).toUpperCase() || 'U'}
                </span>
                <span>{project.user?.username || 'Unknown'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.summaryCards}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryIcon}>📊</div>
          <h3 className={styles.summaryTitle}>Board View</h3>
          <p className={styles.summaryDescription}>
            Visualize your features in a Kanban-style board organized by status
          </p>
          <Link href={`/projects/${projectId}/board`} className={styles.summaryButton}>
            Open Board
          </Link>
        </div>
        
        <div className={styles.summaryCard}>
          <div className={styles.summaryIcon}>📋</div>
          <h3 className={styles.summaryTitle}>List View</h3>
          <p className={styles.summaryDescription}>
            Manage your features in a sortable and filterable table view
          </p>
          <Link href={`/projects/${projectId}/list`} className={styles.summaryButton}>
            Open List
          </Link>
        </div>
        
        <div className={styles.summaryCard}>
          <div className={styles.summaryIcon}>➕</div>
          <h3 className={styles.summaryTitle}>Create Feature</h3>
          <p className={styles.summaryDescription}>
            Add new features to track in this project
          </p>
          <Link href={`/projects/${projectId}/board`} className={styles.summaryButton}>
            Add Feature
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ProjectDetails; 