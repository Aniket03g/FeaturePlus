"use client";
import Link from 'next/link';
import styles from './ProjectCard.module.css';
import type { Project } from '@/app/types/project';
import { useRouter } from 'next/navigation';

interface ProjectCardProps {
  project: Project;
}

const ProjectCard = ({ project }: ProjectCardProps) => {
  const router = useRouter();

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
        <button
          className={styles.settingsIcon}
          aria-label="Project Settings"
          onClick={() => router.push(`/projects/${project.id}/settings`)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="#6B7280" style={{ width: 22, height: 22 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
          </svg>
        </button>
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
         Project Board 
        </Link>
        <div className={styles.viewOptions}>
          <Link href={`/projects/${project.id}/features`} className={styles.viewOption}>
            <span className={styles.viewIcon}>📊</span>
            Features 
          </Link>
          <Link href={`/projects/${project.id}/tasks`} className={styles.viewOption}>
            <span className={styles.viewIcon}>📋</span>
            Tasks 
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ProjectCard; 
