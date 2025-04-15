"use client";
import { useState, useEffect } from 'react';
import API from '@/app/api/api';
import { Feature, User } from '@/app/types';
import styles from './FeatureList.module.css';

interface FeatureListProps {
  projectId: string | number;
  onFeatureUpdated: () => void;
}

const FeatureList = ({ projectId, onFeatureUpdated }: FeatureListProps) => {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingFeature, setEditingFeature] = useState<Feature | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [sortField, setSortField] = useState<keyof Feature>('title');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [featuresRes, usersRes] = await Promise.all([
          API.get(`/features/project/${projectId}`),
          API.get('/users')
        ]);
        setFeatures(featuresRes.data);
        setUsers(usersRes.data);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [projectId]);

  const handleEditFeature = (feature: Feature) => {
    setEditingFeature(feature);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setEditingFeature(null);
  };

  const handleSaveFeature = async (updatedFeature: Feature) => {
    try {
      await API.put(`/features/${updatedFeature.id}`, updatedFeature);
      setFeatures(
        features.map((f) => (f.id === updatedFeature.id ? updatedFeature : f))
      );
      handleModalClose();
      onFeatureUpdated();
    } catch (error) {
      console.error('Error updating feature:', error);
    }
  };

  const handleCreateFeature = async (newFeature: Omit<Feature, 'id' | 'created_at' | 'updated_at'>) => {
    try {
      // Create a properly structured object for the backend
      const submitData = {
        project_id: Number(projectId),
        title: newFeature.title,
        description: newFeature.description,
        status: newFeature.status,
        priority: newFeature.priority,
        assignee_id: newFeature.assignee_id || 0
      };
      
      console.log("Submitting feature data:", submitData);
      
      const response = await API.post('/features', submitData);
      setFeatures([...features, response.data]);
      handleModalClose();
      onFeatureUpdated();
    } catch (error) {
      console.error('Error creating feature:', error);
      alert('Failed to create feature. Please check the console for details.');
    }
  };

  const handleSort = (field: keyof Feature) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
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

  const sortedFeatures = [...features].sort((a, b) => {
    const aValue = a[sortField];
    const bValue = b[sortField];
    
    if (aValue === bValue) return 0;
    
    // Use string comparison for safe sorting
    const aString = String(aValue || '');
    const bString = String(bValue || '');
    const result = aString < bString ? -1 : 1;
    
    return sortDirection === 'asc' ? result : -result;
  });

  if (loading) {
    return <div className={styles.loading}>
      <div className={styles.loadingIndicator}></div>
      <p>Loading features...</p>
    </div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Features</h2>
        <button 
          className={styles.createButton}
          onClick={() => {
            setEditingFeature({
              id: 0,
              project_id: Number(projectId),
              title: '',
              description: '',
              status: 'todo',
              priority: 'medium',
              assignee_id: 0,
              created_at: '',
              updated_at: ''
            });
            setIsModalOpen(true);
          }}
        >
          <span className={styles.plusIcon}>+</span> Add Feature
        </button>
      </div>

      {features.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🔍</div>
          <p className={styles.emptyTitle}>No features found</p>
          <p className={styles.emptyMessage}>Get started by adding your first feature</p>
        </div>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => handleSort('title')} className={sortField === 'title' ? styles.sorted : ''}>
                  Title {sortField === 'title' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('status')} className={sortField === 'status' ? styles.sorted : ''}>
                  Status {sortField === 'status' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('priority')} className={sortField === 'priority' ? styles.sorted : ''}>
                  Priority {sortField === 'priority' && (sortDirection === 'asc' ? '↑' : '↓')}
                </th>
                <th>Assignee</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedFeatures.map((feature) => (
                <tr key={feature.id} className={styles[`row${feature.status}`]}>
                  <td className={styles.titleCell}>
                    <div className={styles.titleRow}>
                      <div className={styles.titleText}>{feature.title}</div>
                      <div className={styles.featureId}>FP-{feature.id}</div>
                    </div>
                    {feature.description && (
                      <div className={styles.description}>{feature.description}</div>
                    )}
                  </td>
                  <td>
                    <span className={`${styles.statusBadge} ${getStatusClass(feature.status)}`}>
                      {getStatusLabel(feature.status)}
                    </span>
                  </td>
                  <td>
                    <span className={`${styles.priorityBadge} ${getPriorityClass(feature.priority)}`}>
                      {feature.priority.charAt(0).toUpperCase() + feature.priority.slice(1)}
                    </span>
                  </td>
                  <td>
                    {feature.assignee ? (
                      <div className={styles.assignee}>
                        <span className={styles.avatar}>
                          {feature.assignee.username.charAt(0).toUpperCase()}
                        </span>
                        <span className={styles.assigneeName}>{feature.assignee.username}</span>
                      </div>
                    ) : (
                      <span className={styles.unassigned}>Unassigned</span>
                    )}
                  </td>
                  <td>
                    <button 
                      className={styles.editButton}
                      onClick={() => handleEditFeature(feature)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h3>{editingFeature?.id ? 'Edit Feature' : 'Create Feature'}</h3>
              <button className={styles.closeButton} onClick={handleModalClose}>×</button>
            </div>
            <FeatureForm 
              feature={editingFeature}
              users={users}
              onClose={handleModalClose}
              onSubmit={editingFeature?.id ? handleSaveFeature : handleCreateFeature}
            />
          </div>
        </div>
      )}
    </div>
  );
};

interface FeatureFormProps {
  feature: Feature | null;
  users: User[];
  onClose: () => void;
  onSubmit: (feature: Feature) => void;
}

const FeatureForm = ({ feature, users, onClose, onSubmit }: FeatureFormProps) => {
  const [formData, setFormData] = useState<Feature | null>(feature);

  if (!formData) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: name === 'assignee_id' ? Number(value) : value
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.formGroup}>
        <label htmlFor="title">Title</label>
        <input
          type="text"
          id="title"
          name="title"
          value={formData.title}
          onChange={handleChange}
          required
          placeholder="Feature title"
        />
      </div>
      
      <div className={styles.formGroup}>
        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          name="description"
          value={formData.description}
          onChange={handleChange}
          rows={4}
          placeholder="Describe the feature..."
        />
      </div>
      
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="status">Status</label>
          <select
            id="status"
            name="status"
            value={formData.status}
            onChange={handleChange}
            className={styles[`status${formData.status.charAt(0).toUpperCase() + formData.status.slice(1)}`]}
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
            value={formData.priority}
            onChange={handleChange}
            className={styles[`priority${formData.priority.charAt(0).toUpperCase() + formData.priority.slice(1)}`]}
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
          value={formData.assignee_id}
          onChange={handleChange}
        >
          <option value={0}>Unassigned</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.username}
            </option>
          ))}
        </select>
      </div>
      
      <div className={styles.formActions}>
        <button type="button" onClick={onClose} className={styles.cancelButton}>
          Cancel
        </button>
        <button type="submit" className={styles.saveButton}>
          {formData.id ? 'Update' : 'Create'} Feature
        </button>
      </div>
    </form>
  );
};

export default FeatureList; 