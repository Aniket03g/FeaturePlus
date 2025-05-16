"use client";
import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import API from '@/app/api/api';
import type { Feature, User } from '@/app/types';
import { Task } from '@/app/types/task';
import styles from './FeatureGroup.module.css';
import TagList from '@/app/features/components/TagList';
import TaskModal from '../components/TaskModal';

// Extend the Feature interface to include the parent_feature_id until it's properly updated in the types file
declare module '@/app/types' {
  interface Feature {
    parent_feature_id?: number | null;
    parent_feature?: Feature;
    tags_input?: string;
    // Note: Keep the type consistent with what's defined elsewhere in the app
  }
}

export default function FeatureGroupPage() {
  const params = useParams();
  const projectId = params?.id as string;
  const featureGroupId = params?.featureId as string;
  const router = useRouter();
  
  const [featureGroup, setFeatureGroup] = useState<Feature | null>(null);
  const [relatedFeatures, setRelatedFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [taskCounts, setTaskCounts] = useState<Record<number, number>>({});
  const [childFeatureCounts, setChildFeatureCounts] = useState<Record<number, number>>({});
  const [sortField, setSortField] = useState<keyof Feature>('title');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [isAddingFeature, setIsAddingFeature] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [selectedFeatureForTasks, setSelectedFeatureForTasks] = useState<Feature | null>(null);
  const [newFeatureForm, setNewFeatureForm] = useState({
    title: '',
    description: '',
    status: 'todo',
    priority: 'medium',
    assignee_id: 0,
    parent_feature_id: parseInt(featureGroupId, 10)
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch the feature group details
        const groupRes = await API.get(`/features/${featureGroupId}`);
        setFeatureGroup(groupRes.data);
        
        // Fetch all features that have this feature as their parent
        const relatedRes = await API.get(`/features/${featureGroupId}/subfeatures`);
        setRelatedFeatures(relatedRes.data);
        
        // Fetch users for assignee names
        const usersRes = await API.get('/users');
        setUsers(usersRes.data);
        
        // Fetch task counts and child feature counts
        const tasksCountMap: Record<number, number> = {};
        const childCountMap: Record<number, number> = {};
        
        // Add task count for the feature group itself
        const groupTasksRes = await API.get(`/features/${featureGroupId}/tasks`);
        tasksCountMap[parseInt(featureGroupId, 10)] = groupTasksRes.data.length;
        
        // Add task counts for each related feature
        await Promise.all(relatedRes.data.map(async (feature: Feature) => {
          try {
            // Fetch task counts
            const tasksRes = await API.get(`/features/${feature.id}/tasks`);
            tasksCountMap[feature.id] = tasksRes.data.length;
            
            // Count child features (third level)
            const subFeaturesRes = await API.get(`/features/${feature.id}/subfeatures`);
            childCountMap[feature.id] = subFeaturesRes.data.length;
          } catch (error) {
            console.error(`Error fetching data for feature ${feature.id}:`, error);
            tasksCountMap[feature.id] = 0;
            childCountMap[feature.id] = 0;
          }
        }));
        
        setTaskCounts(tasksCountMap);
        setChildFeatureCounts(childCountMap);
      } catch (error) {
        console.error('Error fetching feature group data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [featureGroupId]);

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNewFeatureForm({
      ...newFeatureForm,
      [name]: name === 'assignee_id' ? Number(value) : value
    });
  };

  const handleCreateFeature = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Create a properly structured object for the backend
      const submitData = {
        project_id: Number(projectId),
        parent_feature_id: newFeatureForm.parent_feature_id,
        title: newFeatureForm.title,
        description: newFeatureForm.description,
        status: newFeatureForm.status,
        priority: newFeatureForm.priority,
        assignee_id: newFeatureForm.assignee_id || 0
      };
      
      // Use API client to ensure auth headers
      const response = await API.post('/features', submitData);
      
      // Add new feature to the list
      setRelatedFeatures([...relatedFeatures, response.data]);
      setIsAddingFeature(false);
      
      // Reset form
      setNewFeatureForm({
        title: '',
        description: '',
        status: 'todo',
        priority: 'medium',
        assignee_id: 0,
        parent_feature_id: parseInt(featureGroupId, 10)
      });
    } catch (error) {
      console.error('Error creating feature:', error);
      alert('Failed to create feature. Please try again.');
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

  const handleFeatureClick = (feature: Feature) => {
    // If the feature has child features, navigate to its detail page
    if (childFeatureCounts[feature.id] > 0) {
      router.push(`/projects/${projectId}/features/${feature.id}`);
    } else {
      // Otherwise navigate to the tasks page for this feature
      router.push(`/projects/${projectId}/features/${feature.id}/tasks`);
    }
  };

  const sortedFeatures = useMemo(() => {
    return [...relatedFeatures].sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];
      
      if (aValue === bValue) return 0;
      
      // Use string comparison for safe sorting
      const aString = String(aValue || '');
      const bString = String(bValue || '');
      const result = aString < bString ? -1 : 1;
      
      return sortDirection === 'asc' ? result : -result;
    });
  }, [relatedFeatures, sortField, sortDirection]);

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.loadingIndicator}></div>
        <p>Loading feature group...</p>
      </div>
    );
  }

  if (!featureGroup) {
    return <div className={styles.error}>Feature group not found</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.breadcrumbs}>
          <Link href={`/projects/${projectId}/list`} className={styles.breadcrumbLink}>
            Feature Groups
          </Link>
          <span className={styles.breadcrumbSeparator}>/</span>
          <span className={styles.breadcrumbCurrent}>{featureGroup.title}</span>
        </div>
        <button 
          className={styles.addButton}
          onClick={() => setIsAddingFeature(true)}
        >
          + Add Feature
        </button>
      </div>

      <div className={styles.featureGroupDetails}>
        <div className={styles.featureGroupHeader}>
          <h1 className={styles.featureGroupTitle}>
            <span className={styles.featurePrefix}>FP-{featureGroup.id}</span> {featureGroup.title}
          </h1>
          <div className={styles.featureActions}>
            <button 
              className={styles.viewTasksButton}
              onClick={() => {
                setSelectedFeatureForTasks(featureGroup);
                setShowTaskModal(true);
              }}
            >
              View Tasks ({taskCounts[parseInt(featureGroupId, 10)] || 0})
            </button>
          </div>
        </div>
        {featureGroup.description && (
          <p className={styles.featureGroupDescription}>{featureGroup.description}</p>
        )}
        <div className={styles.featureGroupMetadata}>
          <span className={`${styles.statusBadge} ${getStatusClass(featureGroup.status)}`}>
            {getStatusLabel(featureGroup.status)}
          </span>
          <span className={`${styles.priorityBadge} ${getPriorityClass(featureGroup.priority)}`}>
            {featureGroup.priority.charAt(0).toUpperCase() + featureGroup.priority.slice(1)}
          </span>
          {featureGroup.tags && featureGroup.tags.length > 0 && (
            <div className={styles.featureTags}>
              <TagList tags={featureGroup.tags} navigateOnClick={true} />
            </div>
          )}
        </div>
      </div>

      <div className={styles.relatedFeaturesSection}>
        <h2 className={styles.sectionTitle}>Features</h2>
        
        {isAddingFeature && (
          <div className={styles.addFeatureForm}>
            <h3>Add Feature</h3>
            <form onSubmit={handleCreateFeature}>
              <div className={styles.formGroup}>
                <label htmlFor="title">Title *</label>
                <input
                  type="text"
                  id="title"
                  name="title"
                  value={newFeatureForm.title}
                  onChange={handleFormChange}
                  required
                  placeholder="Feature title"
                />
              </div>
              
              <div className={styles.formGroup}>
                <label htmlFor="description">Description</label>
                <textarea
                  id="description"
                  name="description"
                  value={newFeatureForm.description}
                  onChange={handleFormChange}
                  rows={3}
                  placeholder="Describe the feature..."
                />
              </div>
              
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label htmlFor="status">Status</label>
                  <select 
                    id="status" 
                    name="status" 
                    value={newFeatureForm.status}
                    onChange={handleFormChange}
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
                    value={newFeatureForm.priority}
                    onChange={handleFormChange}
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
                  value={newFeatureForm.assignee_id}
                  onChange={handleFormChange}
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
                  onClick={() => setIsAddingFeature(false)}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.submitButton}>
                  Create Feature
                </button>
              </div>
            </form>
          </div>
        )}
        
        {sortedFeatures.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No related features yet. Add some features to this group.</p>
          </div>
        ) : (
          <div className={styles.featuresTable}>
            <table>
              <thead>
                <tr>
                  <th onClick={() => handleSort('title')}>
                    Feature {sortField === 'title' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('status')}>
                    Status {sortField === 'status' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('priority')}>
                    Priority {sortField === 'priority' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th>Assignee</th>
                </tr>
              </thead>
              <tbody>
                {sortedFeatures.map(feature => (
                  <tr key={feature.id} onClick={() => handleFeatureClick(feature)} className={styles.featureRow}>
                    <td>
                      <div className={styles.featureTitle}>
                        <span className={styles.featurePrefix}>FP-{feature.id}</span>
                        <span className={styles.featureName}>{feature.title}</span>
                        {childFeatureCounts[feature.id] > 0 && (
                          <span className={styles.childCount}>
                            ({childFeatureCounts[feature.id]} sub-feature{childFeatureCounts[feature.id] !== 1 ? 's' : ''})
                          </span>
                        )}
                      </div>
                      <div className={styles.featureDescription}>
                        {feature.description && feature.description.length > 100
                          ? `${feature.description.substring(0, 100)}...`
                          : feature.description}
                      </div>
                      <div className={styles.featureActions}>
                        {taskCounts[feature.id] > 0 && (
                          <button
                            className={styles.viewTasksLink}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedFeatureForTasks(feature);
                              setShowTaskModal(true);
                            }}
                          >
                            View {taskCounts[feature.id]} task{taskCounts[feature.id] !== 1 ? 's' : ''}
                          </button>
                        )}
                      </div>
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
                          <span className={styles.assigneeAvatar}>
                            {feature.assignee.username.charAt(0).toUpperCase()}
                          </span>
                          <span className={styles.assigneeName}>
                            {feature.assignee.username}
                          </span>
                        </div>
                      ) : (
                        <span className={styles.unassigned}>Unassigned</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Task Modal */}
      {showTaskModal && selectedFeatureForTasks && (
        <TaskModal
          feature={selectedFeatureForTasks}
          isOpen={showTaskModal}
          onClose={() => {
            setShowTaskModal(false);
            setSelectedFeatureForTasks(null);
          }}
        />
      )}
    </div>
  );
} 