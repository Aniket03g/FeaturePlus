"use client";
import { useState } from 'react';
import styles from './sub-card.module.css';
import { SubFeature } from '@/app/types/subfeature';

interface SubFeatureCardProps {
  subFeature: SubFeature;
  onEdit?: (subFeature: SubFeature) => void;
}

const SubFeatureCard = ({ subFeature, onEdit }: SubFeatureCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getPriorityClass = (priority: string) => {
    switch (priority) {
      case 'high':
        return styles.priorityHigh;
      case 'medium':
        return styles.priorityMedium;
      case 'low':
        return styles.priorityLow;
      default:
        return '';
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'todo':
        return styles.statusTodo;
      case 'in_progress':
        return styles.statusInProgress;
      case 'done':
        return styles.statusDone;
      default:
        return '';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'todo':
        return 'To Do';
      case 'in_progress':
        return 'In Progress';
      case 'done':
        return 'Done';
      default:
        return status;
    }
  };

  return (
    <div 
      className={`${styles.card} ${isExpanded ? styles.expanded : ''}`}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className={styles.header}>
        <div className={styles.titleContainer}>
          {subFeature.status === 'done' && (
            <span className={styles.checkIcon}>✓</span>
          )}
          <h3 className={styles.title}>{subFeature.title}</h3>
        </div>
        <div className={`${styles.priority} ${getPriorityClass(subFeature.priority)}`}>
          {subFeature.priority.charAt(0).toUpperCase() + subFeature.priority.slice(1)}
        </div>
      </div>
      
      {isExpanded && (
        <div className={styles.details}>
          <div className={styles.metadata}>
            <span className={styles.metaItem}>
              <span className={styles.metaLabel}>Status:</span>
              <span className={`${styles.statusBadge} ${getStatusClass(subFeature.status)}`}>
                {getStatusLabel(subFeature.status)}
              </span>
            </span>
            <span className={styles.metaItem}>
              <span className={styles.metaLabel}>ID:</span>
              <span className={styles.subFeatureId}>SF-{subFeature.id}</span>
            </span>
          </div>
          
          {subFeature.description ? (
            <p className={styles.description}>{subFeature.description}</p>
          ) : (
            <p className={styles.noDescription}>No description provided</p>
          )}
          
          {onEdit && (
            <div className={styles.actions}>
              <button 
                className={styles.editButton}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(subFeature);
                }}
              >
                Edit
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SubFeatureCard; 