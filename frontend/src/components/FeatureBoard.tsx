"use client";
import { useState, useEffect } from 'react';
import styles from './FeatureBoard.module.css';
import FeatureCard from '@/app/features/card';
import { Feature, User } from '@/app/types';
import API from '@/app/api/api';

interface FeatureBoardProps {
  projectId: string | number;
  onFeatureUpdated: () => void;
}

const FeatureBoard = ({ projectId, onFeatureUpdated }: FeatureBoardProps) => {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingFeature, setEditingFeature] = useState<Feature | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const fetchFeatures = async () => {
      try {
        setLoading(true);
        const [featuresRes, usersRes] = await Promise.all([
          API.get(`/features/project/${projectId}`),
          API.get('/users')
        ]);
        setFeatures(featuresRes.data);
        setUsers(usersRes.data);
      } catch (err) {
        console.error('Error fetching data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchFeatures();
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

  const todoFeatures = features.filter((f) => f.status === 'todo');
  const inProgressFeatures = features.filter((f) => f.status === 'in_progress');
  const doneFeatures = features.filter((f) => f.status === 'done');

  if (loading) {
    return <div className={styles.loading}>
      <div className={styles.loadingIndicator}></div>
      <p>Loading features...</p>
    </div>;
  }

  return (
    <div className={styles.board}>
      <div className={styles.controls}>
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

      <div className={styles.columns}>
        <div className={styles.column}>
          <div className={styles.columnHeader}>
            <h3>To Do</h3>
            <span className={styles.count}>{todoFeatures.length}</span>
          </div>
          <div className={styles.columnContent}>
            {todoFeatures.map((feature) => (
              <FeatureCard
                key={feature.id}
                feature={feature}
                onEdit={handleEditFeature}
              />
            ))}
            {todoFeatures.length === 0 && (
              <div className={styles.emptyColumn}>No features to do</div>
            )}
          </div>
        </div>

        <div className={styles.column}>
          <div className={styles.columnHeader}>
            <h3>In Progress</h3>
            <span className={styles.count}>{inProgressFeatures.length}</span>
          </div>
          <div className={styles.columnContent}>
            {inProgressFeatures.map((feature) => (
              <FeatureCard
                key={feature.id}
                feature={feature}
                onEdit={handleEditFeature}
              />
            ))}
            {inProgressFeatures.length === 0 && (
              <div className={styles.emptyColumn}>No features in progress</div>
            )}
          </div>
        </div>

        <div className={styles.column}>
          <div className={styles.columnHeader}>
            <h3>Done</h3>
            <span className={styles.count}>{doneFeatures.length}</span>
          </div>
          <div className={styles.columnContent}>
            {doneFeatures.map((feature) => (
              <FeatureCard
                key={feature.id}
                feature={feature}
                onEdit={handleEditFeature}
              />
            ))}
            {doneFeatures.length === 0 && (
              <div className={styles.emptyColumn}>No completed features</div>
            )}
          </div>
        </div>
      </div>

      {isModalOpen && (
        <FeatureModal
          feature={editingFeature}
          users={users}
          onClose={handleModalClose}
          onSave={editingFeature?.id ? handleSaveFeature : handleCreateFeature}
        />
      )}
    </div>
  );
};

interface FeatureModalProps {
  feature: Feature | null;
  users: User[];
  onClose: () => void;
  onSave: (feature: Feature) => void;
}

const FeatureModal = ({ feature, users, onClose, onSave }: FeatureModalProps) => {
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
    onSave(formData);
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3>{formData.id ? 'Edit Feature' : 'Create Feature'}</h3>
          <button className={styles.closeButton} onClick={onClose}>×</button>
        </div>
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
      </div>
    </div>
  );
};

export default FeatureBoard; 