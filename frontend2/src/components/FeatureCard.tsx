"use client";
import { useState } from 'react';
import styles from './FeatureCard.module.css';
import { Feature } from '@/app/types';

interface FeatureCardProps {
  feature: Feature;
  onEdit: (feature: Feature) => void;
}

const FeatureCard = ({ feature, onEdit }: FeatureCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getPriorityClass = (priority: string) => {
    switch (priority) {
      case 'high':
        return styles.highPriority;
      case 'medium':
        return styles.mediumPriority;
      case 'low':
        return styles.lowPriority;
      default:
        return '';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'todo':
        return styles.todoStatus;
      case 'in_progress':
        return styles.inProgressStatus;
      case 'done':
        return styles.doneStatus;
      default:
        return '';
    }
  };

  return (
    <div 
      className={`${styles.card} ${isExpanded ? styles.expanded : ''} ${getStatusColor(feature.status)}`}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className={styles.header}>
        <div className={styles.titleContainer}>
          {feature.status === 'done' && (
            <span className={styles.checkIcon}>✓</span>
          )}
          <h3 className={styles.title}>{feature.title}</h3>
        </div>
        <div className={`${styles.priority} ${getPriorityClass(feature.priority)}`}>
          {feature.priority.charAt(0).toUpperCase() + feature.priority.slice(1)}
        </div>
      </div>
      
      {isExpanded && (
        <div className={styles.details}>
          <div className={styles.metadata}>
            <span className={styles.metaItem}>
              <span className={styles.metaLabel}>Status:</span>
              <span className={`${styles.statusBadge} ${getStatusColor(feature.status)}`}>
                {feature.status === 'in_progress' ? 'In Progress' : 
                 feature.status.charAt(0).toUpperCase() + feature.status.slice(1)}
              </span>
            </span>
            <span className={styles.metaItem}>
              <span className={styles.metaLabel}>ID:</span>
              <span className={styles.featureId}>FP-{feature.id}</span>
            </span>
          </div>
          
          {feature.description ? (
            <p className={styles.description}>{feature.description}</p>
          ) : (
            <p className={styles.noDescription}>No description provided</p>
          )}
          
          <div className={styles.meta}>
            <div className={styles.assignee}>
              <span className={styles.avatar}>
                {feature.assignee ? feature.assignee.username.charAt(0).toUpperCase() : 'U'}
              </span>
              <span className={styles.assigneeName}>
                {feature.assignee ? feature.assignee.username : 'Unassigned'}
              </span>
            </div>
            <button 
              className={styles.editButton}
              onClick={(e) => {
                e.stopPropagation();
                onEdit(feature);
              }}
            >
              Edit
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FeatureCard; 