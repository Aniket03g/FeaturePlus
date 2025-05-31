"use client";
import Link from 'next/link';
import styles from './ProjectCard.module.css';
import type { Project } from '@/app/types/project';
import { SettingsIcon } from '../../../icons';

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
        <h3 className={styles.title}>{project.name}</h3>
        <Link href={`/projects/${project.id}/settings`} className={styles.settingsButton} title="Project Settings">
          <SettingsIcon className={styles.settingsIcon} />
        </Link>
      </div>
      <div className={styles.description}>
        {project.description ? project.description : (
          <span className={styles.noDescription}>No description provided</span>
        )}
      </div>
      <div className={styles.meta}>
        <div className={styles.dates}>
          <div className={styles.dateItem}>
            <span className={styles.dateLabel}>Created At</span>
            <span className={styles.dateValue}>{formatDate(project.created_at)}</span>
          </div>
        </div>
      </div>
      <div className={styles.actions}>
        <Link href={`/projects/${project.id}`} className={styles.detailsButton}>
          Project Board
        </Link>
        <div className={styles.viewOptions}>
          <Link href={`/projects/${project.id}/features`} className={styles.viewOption}>
            Features
          </Link>
          <Link href={`/projects/${project.id}/tasks`} className={styles.viewOption}>
            Tasks
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ProjectCard; 
