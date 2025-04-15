"use client";
import Link from 'next/link';
import styles from './ProjectCard.module.css';
import type { Project } from '@/app/types/project';

interface ProjectCardProps {
  project: Project;
}

const ProjectCard = ({ project }: ProjectCardProps) => {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getStatusClass = () => {
    if (!project.status) return styles.statusPending;
    
    switch (project.status.toLowerCase()) {
      case 'active':
        return styles.statusActive;
      case 'pending':
        return styles.statusPending;
      case 'completed':
        return styles.statusCompleted;
      case 'paused':
        return styles.statusPaused;
      case 'cancelled':
        return styles.statusCancelled;
      default:
        return styles.statusPending;
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.statusBadge + ' ' + getStatusClass()}>
          {project.status || 'Pending'}
        </div>
        <div className={styles.projectId}>#{project.id}</div>
      </div>
      
      <h3 className={styles.title}>{project.name}</h3>
      
      <div className={styles.description}>
        {project.description ? (
          project.description.length > 120 ? 
            `${project.description.substring(0, 120)}...` : 
            project.description
        ) : (
          <span className={styles.noDescription}>No description provided</span>
        )}
      </div>
      
      <div className={styles.meta}>
        <div className={styles.dates}>
          <div className={styles.dateItem}>
            <span className={styles.dateLabel}>Created</span>
            <span className={styles.dateValue}>{formatDate(project.created_at)}</span>
          </div>
          <div className={styles.dateItem}>
            <span className={styles.dateLabel}>Updated</span>
            <span className={styles.dateValue}>{formatDate(project.updated_at)}</span>
          </div>
        </div>
        
        {project.user && project.user.username && (
          <div className={styles.owner}>
            <span className={styles.avatar}>
              {project.user.username.charAt(0).toUpperCase()}
            </span>
            <span className={styles.ownerName}>{project.user.username}</span>
          </div>
        )}
      </div>
      
      <div className={styles.actions}>
        <Link href={`/projects/${project.id}`} className={styles.detailsButton}>
          View Details
        </Link>
        <div className={styles.viewOptions}>
          <Link href={`/projects/${project.id}/board`} className={styles.viewOption}>
            <span className={styles.viewIcon}>📊</span>
            Board
          </Link>
          <Link href={`/projects/${project.id}/list`} className={styles.viewOption}>
            <span className={styles.viewIcon}>📋</span>
            List
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ProjectCard; 