"use client";
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import API from '@/app/api/api';
import type { Feature, User } from '@/app/types';
import { SubFeature } from '@/app/types/subfeature';
import styles from './SubFeatures.module.css';

export default function SubFeaturesPage() {
  const params = useParams();
  const projectId = params?.id as string;
  const featureId = params?.featureId as string;
  const router = useRouter();
  
  const [feature, setFeature] = useState<Feature | null>(null);
  const [subFeatures, setSubFeatures] = useState<SubFeature[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddingSubFeature, setIsAddingSubFeature] = useState(false);
  const [subFeatureForm, setSubFeatureForm] = useState({
    title: '',
    description: '',
    status: 'todo',
    priority: 'medium',
    assignee_id: 0
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [featureRes, subFeaturesRes, usersRes] = await Promise.all([
          API.get(`/features/${featureId}`),
          API.get(`/sub-features?feature_id=${featureId}`),
          API.get('/users')
        ]);
        
        setFeature(featureRes.data);
        setSubFeatures(subFeaturesRes.data);
        setUsers(usersRes.data);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [featureId]);

  const handleSubFeatureFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setSubFeatureForm({
      ...subFeatureForm,
      [name]: name === 'assignee_id' ? Number(value) : value
    });
  };

  const handleSubmitSubFeature = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await API.post('/sub-features', {
        ...subFeatureForm,
        feature_id: Number(featureId)
      });

      const newSubFeature = response.data;
      setSubFeatures([...subFeatures, newSubFeature]);
      setIsAddingSubFeature(false);
      setSubFeatureForm({
        title: '',
        description: '',
        status: 'todo',
        priority: 'medium',
        assignee_id: 0
      });
    } catch (error) {
      console.error('Error creating sub-feature:', error);
      alert('Failed to create sub-feature');
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'todo': return 'To Do';
      case 'in_progress': return 'In Progress';
      case 'done': return 'Done';
      default: return status;
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'todo': return styles.statusTodo;
      case 'in_progress': return styles.statusInProgress;
      case 'done': return styles.statusDone;
      default: return '';
    }
  };

  const getPriorityClass = (priority: string) => {
    switch (priority) {
      case 'high': return styles.priorityHigh;
      case 'medium': return styles.priorityMedium;
      case 'low': return styles.priorityLow;
      default: return '';
    }
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.loadingIndicator}></div>
        <p>Loading sub-features...</p>
      </div>
    );
  }

  if (!feature) {
    return <div className={styles.error}>Feature not found</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.breadcrumbs}>
          <Link href={`/projects/${projectId}/list`} className={styles.breadcrumbLink}>
            Features
          </Link>
          <span className={styles.breadcrumbSeparator}>/</span>
          <span className={styles.breadcrumbCurrent}>{feature.title}</span>
        </div>
        <button 
          className={styles.addButton}
          onClick={() => setIsAddingSubFeature(true)}
        >
          + Add Sub-feature
        </button>
      </div>

      <div className={styles.featureDetails}>
        <div className={styles.featureHeader}>
          <h1 className={styles.featureTitle}>{feature.title}</h1>
          <div className={styles.featureId}>FP-{feature.id}</div>
        </div>
        {feature.description && (
          <p className={styles.featureDescription}>{feature.description}</p>
        )}
        <div className={styles.featureMetadata}>
          <span className={`${styles.statusBadge} ${getStatusClass(feature.status)}`}>
            {getStatusLabel(feature.status)}
          </span>
          <span className={`${styles.priorityBadge} ${getPriorityClass(feature.priority)}`}>
            {feature.priority.charAt(0).toUpperCase() + feature.priority.slice(1)}
          </span>
        </div>
      </div>

      <div className={styles.subFeaturesSection}>
        <h2 className={styles.sectionTitle}>Sub-features</h2>
        
        {isAddingSubFeature && (
          <div className={styles.addSubFeatureForm}>
            <h3>Add Sub-feature</h3>
            <form onSubmit={handleSubmitSubFeature}>
              <div className={styles.formGroup}>
                <label htmlFor="title">Title *</label>
                <input
                  type="text"
                  id="title"
                  name="title"
                  value={subFeatureForm.title}
                  onChange={handleSubFeatureFormChange}
                  required
                  placeholder="Sub-feature title"
                />
              </div>
              
              <div className={styles.formGroup}>
                <label htmlFor="description">Description</label>
                <textarea
                  id="description"
                  name="description"
                  value={subFeatureForm.description}
                  onChange={handleSubFeatureFormChange}
                  rows={3}
                  placeholder="Describe the sub-feature..."
                />
              </div>
              
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label htmlFor="status">Status</label>
                  <select 
                    id="status" 
                    name="status" 
                    value={subFeatureForm.status}
                    onChange={handleSubFeatureFormChange}
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>
                
                <div className={styles.formGroup}>
                  <label htmlFor="priority">Priority</label>
                  <select 
                    id="priority" 
                    name="priority" 
                    value={subFeatureForm.priority}
                    onChange={handleSubFeatureFormChange}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>
              
              <div className={styles.formGroup}>
                <label htmlFor="assignee_id">Assignee</label>
                <select 
                  id="assignee_id" 
                  name="assignee_id" 
                  value={subFeatureForm.assignee_id}
                  onChange={handleSubFeatureFormChange}
                >
                  <option value={0}>Unassigned</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>
                      {user.username}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className={styles.formActions}>
                <button 
                  type="button" 
                  className={styles.cancelButton}
                  onClick={() => setIsAddingSubFeature(false)}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.submitButton}>
                  Create Sub-feature
                </button>
              </div>
            </form>
          </div>
        )}
        
        {subFeatures.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🔍</div>
            <p className={styles.emptyTitle}>No sub-features found</p>
            <p className={styles.emptyMessage}>Get started by adding your first sub-feature</p>
          </div>
        ) : (
          <div className={styles.subFeatureList}>
            {subFeatures.map(subFeature => (
              <div key={subFeature.id} className={styles.subFeatureCard}>
                <div className={styles.subFeatureHeader}>
                  <h3 className={styles.subFeatureTitle}>{subFeature.title}</h3>
                  <div className={styles.subFeatureId}>SF-{subFeature.id}</div>
                </div>
                {subFeature.description && (
                  <p className={styles.subFeatureDescription}>{subFeature.description}</p>
                )}
                <div className={styles.subFeatureFooter}>
                  <div className={styles.subFeatureMetadata}>
                    <span className={`${styles.statusBadge} ${getStatusClass(subFeature.status)}`}>
                      {getStatusLabel(subFeature.status)}
                    </span>
                    <span className={`${styles.priorityBadge} ${getPriorityClass(subFeature.priority)}`}>
                      {subFeature.priority.charAt(0).toUpperCase() + subFeature.priority.slice(1)}
                    </span>
                  </div>
                  <button className={styles.editButton}>
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
} 