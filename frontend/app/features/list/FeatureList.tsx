"use client";
import { useState, useEffect } from 'react';
import API from '@/app/api/api';
import type { Feature, User } from '@/app/types';
import { SubFeature } from '@/app/types/subfeature';
import styles from './FeatureList.module.css';
import { useRouter } from 'next/navigation';

interface FeatureListProps {
  projectId: string | number;
  onFeatureUpdated: () => void;
}

const FeatureList = ({ projectId, onFeatureUpdated }: FeatureListProps) => {
  const router = useRouter();
  const [features, setFeatures] = useState<Feature[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingFeature, setEditingFeature] = useState<Feature | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [sortField, setSortField] = useState<keyof Feature>('title');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [subFeatureCounts, setSubFeatureCounts] = useState<Record<number, number>>({});
  const [selectedFeatureSubFeatures, setSelectedFeatureSubFeatures] = useState<SubFeature[]>([]);
  const [selectedFeatureId] = useState<number | null>(null);
  const [showGlobalSubFeatureForm, setShowGlobalSubFeatureForm] = useState(false);

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

        // Fetch sub-feature counts for each feature
        const counts: Record<number, number> = {};
        await Promise.all(
          featuresRes.data.map(async (feature: Feature) => {
            try {
              const response = await fetch(`http://localhost:8080/api/sub-features?feature_id=${feature.id}`);
              if (response.ok) {
                const subFeatures = await response.json();
                counts[feature.id] = subFeatures.length;
              }
            } catch (error) {
              console.error(`Error fetching sub-features for feature ${feature.id}:`, error);
              counts[feature.id] = 0;
            }
          })
        );
        setSubFeatureCounts(counts);
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

  const handleNavigateToSubFeatures = (featureId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/projects/${projectId}/features/${featureId}/sub-features`);
  };

  const handleCreateSubFeature = async (subFeature: Partial<SubFeature>) => {
    const featureId = subFeature.feature_id || selectedFeatureId;
    if (!featureId) return;
    
    try {
      const response = await fetch('http://localhost:8080/api/sub-features', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...subFeature,
          feature_id: featureId,
        }),
      });

      if (!response.ok) throw new Error('Failed to create sub-feature');
      
      const newSubFeature = await response.json();
      
      // Update sub-features list if we're viewing them
      if (selectedFeatureId === featureId) {
        setSelectedFeatureSubFeatures([...selectedFeatureSubFeatures, newSubFeature]);
      }
      
      // Update the sub-feature count
      setSubFeatureCounts({
        ...subFeatureCounts,
        [featureId]: (subFeatureCounts[featureId] || 0) + 1
      });
      
      // Close the appropriate modal
      if (showGlobalSubFeatureForm) {
        setShowGlobalSubFeatureForm(false);
      }
    } catch (error) {
      console.error('Error creating sub-feature:', error);
      alert('Failed to create sub-feature');
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
    <div className={styles.pageWrapper}>
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerButtons}>
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
                  updated_at: '',
                  tag: 'p2',
                });
                setIsModalOpen(true);
              }}
            >
              <span className={styles.plusIcon}>+</span> Add Feature
            </button>
            <button 
              className={styles.createSubFeatureButton}
              onClick={() => setShowGlobalSubFeatureForm(true)}
            >
              <span className={styles.plusIcon}>+</span> Add Sub-feature
            </button>
          </div>
        </div>

        <div className={styles.tableHeader}>
          <h2>Features</h2>
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
                  <th className={styles.titleCell} onClick={() => handleSort('title')}>
                    Title {sortField === 'title' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className={styles.statusCell} onClick={() => handleSort('status')}>
                    Status {sortField === 'status' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className={styles.priorityCell} onClick={() => handleSort('priority')}>
                    Priority {sortField === 'priority' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className={styles.assigneeCell}>Assignee</th>
                  <th className={styles.actionsCell}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedFeatures.map((feature) => (
                  <tr key={feature.id} className={styles[`row${feature.status}`]}>
                    <td className={styles.titleCell}>
                      <div className={styles.titleMain}>
                        <div className={styles.titleHeader}>
                          <div className={styles.featureTitle}>{feature.title}</div>
                          <div className={styles.featureId}>FP-{feature.id}</div>
                          <button
                            className={styles.subFeatureButton}
                            onClick={(e) => handleNavigateToSubFeatures(feature.id, e)}
                            title="View sub-features"
                          >
                            {subFeatureCounts[feature.id] || 0} sub-features
                          </button>
                        </div>
                        {feature.description && (
                          <div className={styles.description}>{feature.description}</div>
                        )}
                        {feature.tag && (
                          <div style={{ marginTop: 4 }}>
                            <span
                              className={
                                feature.tag === 'p0' ? styles.tagP0 : feature.tag === 'p1' ? styles.tagP1 : styles.tagP2
                              }
                              style={{ cursor: 'pointer' }}
                              onClick={() => router.push(`/features/tags/${feature.tag}`)}
                              title={`Show all features with tag ${feature.tag.toUpperCase()}`}
                            >
                              {feature.tag.toUpperCase()}
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className={styles.statusCell}>
                      <span className={`${styles.statusBadge} ${getStatusClass(feature.status)}`}>
                        {getStatusLabel(feature.status)}
                      </span>
                    </td>
                    <td className={styles.priorityCell}>
                      <span className={`${styles.priorityBadge} ${getPriorityClass(feature.priority)}`}>
                        {feature.priority.charAt(0).toUpperCase() + feature.priority.slice(1)}
                      </span>
                    </td>
                    <td className={styles.assigneeCell}>
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
                    <td className={styles.actionsCell}>
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

        {showGlobalSubFeatureForm && (
          <div className={styles.modalOverlay} onClick={() => setShowGlobalSubFeatureForm(false)}>
            <div className={styles.modal} onClick={e => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>Add Sub-feature</h3>
                <button className={styles.closeButton} onClick={() => setShowGlobalSubFeatureForm(false)}>×</button>
              </div>
              <div className={styles.modalContent}>
                <div className={styles.subFeatureForm}>
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    const formData = new FormData(e.currentTarget);
                    handleCreateSubFeature({
                      title: formData.get('title') as string,
                      description: formData.get('description') as string,
                      status: formData.get('status') as 'todo' | 'in_progress' | 'done',
                      priority: formData.get('priority') as 'low' | 'medium' | 'high',
                      assignee_id: Number(formData.get('assignee_id')) || 0,
                      feature_id: Number(formData.get('feature_id')),
                    });
                  }}>
                    <div className={styles.formGroup}>
                      <label htmlFor="feature_id">Parent Feature *</label>
                      <select
                        id="feature_id"
                        name="feature_id"
                        required
                        defaultValue=""
                      >
                        <option value="" disabled>Select a feature</option>
                        {features.map(feature => (
                          <option key={feature.id} value={feature.id}>
                            {feature.title}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className={styles.formGroup}>
                      <label htmlFor="title">Title *</label>
                      <input
                        type="text"
                        id="title"
                        name="title"
                        required
                        placeholder="Sub-feature title"
                      />
                    </div>
                    
                    <div className={styles.formGroup}>
                      <label htmlFor="description">Description</label>
                      <textarea
                        id="description"
                        name="description"
                        rows={3}
                        placeholder="Describe the sub-feature..."
                      />
                    </div>
                    
                    <div className={styles.formGroup}>
                      <label htmlFor="status">Status</label>
                      <select id="status" name="status" defaultValue="todo">
                        <option value="todo">To Do</option>
                        <option value="in_progress">In Progress</option>
                        <option value="done">Done</option>
                      </select>
                    </div>
                    
                    <div className={styles.formGroup}>
                      <label htmlFor="priority">Priority</label>
                      <select id="priority" name="priority" defaultValue="medium">
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                    
                    <div className={styles.formGroup}>
                      <label htmlFor="assignee_id">Assignee</label>
                      <select id="assignee_id" name="assignee_id" defaultValue="">
                        <option value="">Unassigned</option>
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
                        onClick={() => setShowGlobalSubFeatureForm(false)}
                      >
                        Cancel
                      </button>
                      <button type="submit" className={styles.submitButton}>
                        Create Sub-feature
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
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