"use client";
import { useState, useEffect, useMemo } from 'react';
import API, { TagsAPI } from '@/app/api/api';
import type { Feature, User } from '@/app/types';
import { SubFeature } from '@/app/types/subfeature';
import { Task } from '@/app/types/task';
import styles from './FeatureList.module.css';
import { useRouter } from 'next/navigation';
import TagList from '../components/TagList';

// Extend the Feature interface to include the parent_feature_id until it's properly updated in the types file
declare module '@/app/types' {
  interface Feature {
    parent_feature_id?: number | null;
    parent_feature?: Feature;
    tags_input?: string;
    category?: string;
  }
}

interface FeatureListProps {
  projectId: string | number;
  onFeatureUpdated: () => void;
  categories: string[];
}

const FeatureList = ({ projectId, onFeatureUpdated, categories }: FeatureListProps) => {
  const router = useRouter();
  const [features, setFeatures] = useState<Feature[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingFeature, setEditingFeature] = useState<Feature | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [sortField, setSortField] = useState<keyof Feature>('title');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [subFeatureCounts, setSubFeatureCounts] = useState<Record<number, number>>({});
  const [taskCounts, setTaskCounts] = useState<Record<number, number>>({});
  const [selectedFeatureSubFeatures, setSelectedFeatureSubFeatures] = useState<SubFeature[]>([]);
  const [selectedFeatureId] = useState<number | null>(null);
  const [showGlobalSubFeatureForm, setShowGlobalSubFeatureForm] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [featureTasks, setFeatureTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [isTaskFormOpen, setIsTaskFormOpen] = useState(false);
  const [newTask, setNewTask] = useState<{
    task_name: string;
    description: string;
    task_type: string;
  }>({
    task_name: '',
    description: '',
    task_type: 'UI',
  });
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isEditTaskFormOpen, setIsEditTaskFormOpen] = useState(false);
  const [confirmDeleteTaskId, setConfirmDeleteTaskId] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'root' | 'sub'>('root');
  const [childFeatureCounts, setChildFeatureCounts] = useState<Record<number, number>>({});
  const [modalType, setModalType] = useState<'featureGroup' | 'feature'>('featureGroup');

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
        const taskCounts: Record<number, number> = {};
        const childFeatureCounts: Record<number, number> = {};
        await Promise.all(
          featuresRes.data.map(async (feature: Feature) => {
            try {
              const subFeaturesResponse = await API.get(`/sub-features?feature_id=${feature.id}`);
              counts[feature.id] = subFeaturesResponse.data.length;
              
              // Fetch task counts for each feature
              const tasksResponse = await API.get(`/features/${feature.id}/tasks`);
              taskCounts[feature.id] = tasksResponse.data.length;
            } catch (error) {
              console.error(`Error fetching data for feature ${feature.id}:`, error);
              counts[feature.id] = 0;
              taskCounts[feature.id] = 0;
            }
          })
        );
        setSubFeatureCounts(counts);
        setTaskCounts(taskCounts);

        // First pass to collect all features
        const allFeatures = featuresRes.data as Feature[];
        
        // Second pass to count child features
        allFeatures.forEach(feature => {
          if (feature.parent_feature_id) {
            const parentId = feature.parent_feature_id;
            childFeatureCounts[parentId] = (childFeatureCounts[parentId] || 0) + 1;
          }
        });
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [projectId]);

  // Function to fetch features and update state
  const fetchFeatures = async () => {
    try {
      const featuresRes = await API.get(`/features/project/${projectId}`);
      setFeatures(featuresRes.data);
      
      // Fetch sub-feature counts for each feature
      const counts: Record<number, number> = {};
      const taskCounts: Record<number, number> = {};
      const childFeatureCounts: Record<number, number> = {};
      
      // First pass to collect all features
      const allFeatures = featuresRes.data as Feature[];
      
      // Second pass to count child features
      allFeatures.forEach(feature => {
        if (feature.parent_feature_id) {
          const parentId = feature.parent_feature_id;
          childFeatureCounts[parentId] = (childFeatureCounts[parentId] || 0) + 1;
        }
      });
      
      await Promise.all(
        featuresRes.data.map(async (feature: Feature) => {
          try {
            // Use API client instead of fetch
            const subFeaturesResponse = await API.get(`/sub-features?feature_id=${feature.id}`);
            counts[feature.id] = subFeaturesResponse.data.length;
            
            // Fetch task counts for each feature
            const tasksResponse = await API.get(`/features/${feature.id}/tasks`);
            taskCounts[feature.id] = tasksResponse.data.length;
          } catch (error) {
            console.error(`Error fetching data for feature ${feature.id}:`, error);
            counts[feature.id] = 0;
            taskCounts[feature.id] = 0;
          }
        })
      );
      
      setSubFeatureCounts(counts);
      setTaskCounts(taskCounts);
      setChildFeatureCounts(childFeatureCounts);
    } catch (error) {
      console.error('Error fetching features:', error);
    }
  };

  const handleFeatureClick = async (feature: Feature) => {
    // Navigate to the feature details page where all related features will be displayed
    router.push(`/projects/${projectId}/features/${feature.id}`);
  };
  
  const fetchTasksForFeature = async (featureId: number) => {
    setLoadingTasks(true);
    try {
      // Use API client instead of fetch
      const response = await API.get(`/features/${featureId}/tasks`);
      console.log(`Fetched ${response.data.length} tasks for feature ${featureId}`, response.data);
      setFeatureTasks(response.data);
    } catch (error) {
      console.error('Error fetching tasks:', error);
      setFeatureTasks([]);
    } finally {
      setLoadingTasks(false);
    }
  };

  const handlePopupClose = () => {
    setIsPopupOpen(false);
    setSelectedFeature(null);
    setFeatureTasks([]);
  };

  const handleEditFeature = (feature: Feature, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setEditingFeature(feature);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setEditingFeature(null);
  };

  const handleSaveFeature = async (updatedFeature: Feature) => {
    try {
      // Include tags_input in the update data
      const updateData = {
        ...updatedFeature,
        tags_input: updatedFeature.tags_input || ''
      };
      
      console.log("Updating feature with data:", updateData);
      
      // Use API client instead of fetch
      await API.put(`/features/${updatedFeature.id}`, updateData);

      await fetchFeatures();
      handleModalClose();
      onFeatureUpdated();
    } catch (error) {
      console.error('Error updating feature:', error);
      alert('Failed to update feature. Please try again.');
    }
  };

  const handleCreateFeature = async (newFeature: Feature) => {
    try {
      // Create a properly structured object for the backend
      const submitData = {
        project_id: Number(projectId),
        parent_feature_id: newFeature.parent_feature_id,
        title: newFeature.title,
        description: newFeature.description,
        status: newFeature.status,
        priority: newFeature.priority,
        assignee_id: newFeature.assignee_id || 0,
        tags_input: newFeature.tags_input || ''
      };
      
      console.log("Submitting feature data:", submitData);
      
      // Use API client instead of fetch to ensure auth headers are included
      const response = await API.post('/features', submitData);

      await fetchFeatures();
      handleModalClose();
      onFeatureUpdated();
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

  const handleNavigateToSubFeatures = (featureId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/projects/${projectId}/features/${featureId}/sub-features`);
  };

  const handleCreateSubFeature = async (subFeature: Partial<SubFeature>) => {
    const featureId = subFeature.feature_id || selectedFeatureId;
    if (!featureId) return;
    
    try {
      // Use API client instead of fetch to ensure auth headers are included
      const response = await API.post('/sub-features', {
        ...subFeature,
        feature_id: featureId,
      });
      
      const newSubFeature = response.data;
      
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

  const handleFilterChange = (type: 'all' | 'root' | 'sub') => {
    setFilterType(type);
  };

  const filteredFeatures = useMemo(() => {
    switch (filterType) {
      case 'root':
        return features.filter(feature => !feature.parent_feature_id);
      case 'sub':
        return features.filter(feature => feature.parent_feature_id !== null);
      default:
        return features;
    }
  }, [features, filterType]);
  
  const sortedFeatures = [...filteredFeatures].sort((a, b) => {
    const aValue = a[sortField];
    const bValue = b[sortField];
    
    if (aValue === bValue) return 0;
    
    // Use string comparison for safe sorting
    const aString = String(aValue || '');
    const bString = String(bValue || '');
    const result = aString < bString ? -1 : 1;
    
    return sortDirection === 'asc' ? result : -result;
  });

  const handleAddTask = () => {
    if (!selectedFeature) return;
    setIsTaskFormOpen(true);
  };

  const handleTaskFormClose = () => {
    setIsTaskFormOpen(false);
    setNewTask({
      task_name: '',
      description: '',
      task_type: 'UI',
    });
  };

  const handleTaskInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNewTask({ ...newTask, [name]: value });
  };

  const handleTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFeature) return;
    
    try {
      // Make sure all required fields are included and properly formatted
      const taskData = {
        task_name: newTask.task_name,
        description: newTask.description || "",
        task_type: newTask.task_type,
        feature_id: Number(selectedFeature.id) // Ensure feature_id is a number
      };
      
      console.log("Creating task with data:", taskData);
      
      // Use API client instead of fetch to ensure auth headers are included
      const response = await API.post(`/features/${selectedFeature.id}/tasks`, taskData);
      const createdTask = response.data;
      
      // Add the new task to the tasks list
      setFeatureTasks([...featureTasks, createdTask]);
      
      // Update the task count for this feature
      setTaskCounts({
        ...taskCounts,
        [selectedFeature.id]: (taskCounts[selectedFeature.id] || 0) + 1
      });
      
      // Close the form
      handleTaskFormClose();
    } catch (error) {
      console.error('Error creating task:', error);
      alert('Failed to create task. Please try again.');
    }
  };

  const handleEditTask = (task: Task) => {
    setEditingTask({...task});
    setIsEditTaskFormOpen(true);
  };

  const handleEditTaskFormClose = () => {
    setIsEditTaskFormOpen(false);
    setEditingTask(null);
  };

  const handleEditTaskInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    if (!editingTask) return;
    const { name, value } = e.target;
    setEditingTask({ ...editingTask, [name]: value });
  };

  const handleEditTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFeature || !editingTask) return;
    
    try {
      // Create a properly structured task object for the backend
      const taskData = {
        id: Number(editingTask.id),
        task_name: editingTask.task_name,
        description: editingTask.description || "",
        task_type: editingTask.task_type,
        feature_id: Number(selectedFeature.id)
        // No need to specify created_by_user as the backend will handle it
      };
      
      console.log("Updating task with data:", taskData);
      
      // Use API client instead of fetch
      const response = await API.put(`/features/${selectedFeature.id}/task/${editingTask.id}`, taskData);
      const updatedTask = response.data;
      
      // Update the task in the tasks list
      setFeatureTasks(featureTasks.map(task => 
        task.id === updatedTask.id ? updatedTask : task
      ));
      
      // Close the form
      handleEditTaskFormClose();
    } catch (error) {
      console.error('Error updating task:', error);
      alert('Failed to update task. Please try again.');
    }
  };

  const handleDeleteTask = (taskId: number) => {
    console.log(`Delete button clicked for task ID: ${taskId}`);
    if (taskId && !isNaN(taskId)) {
      setConfirmDeleteTaskId(taskId);
    } else {
      console.error("Invalid task ID:", taskId);
    }
  };

  const handleCancelDeleteTask = () => {
    setConfirmDeleteTaskId(null);
  };

  const executeTaskDeletion = async (taskId: number) => {
    if (!selectedFeature) {
      console.error("No selected feature");
      return;
    }
    
    if (!taskId || isNaN(taskId)) {
      console.error("Invalid task ID for deletion:", taskId);
      return;
    }
    
    try {
      const url = `/features/${selectedFeature.id}/task/${taskId}`;
      console.log(`Deleting task ID: ${taskId} from feature ID: ${selectedFeature.id}`);
      console.log(`DELETE request to: ${url}`);
      
      // Use API client instead of fetch
      await API.delete(url);
      
      console.log("Task deleted successfully");
      
      // Clear the confirmation
      setConfirmDeleteTaskId(null);
      
      // Update the task count for this feature
      if (selectedFeature && taskCounts[selectedFeature.id] > 0) {
        setTaskCounts({
          ...taskCounts,
          [selectedFeature.id]: taskCounts[selectedFeature.id] - 1
        });
      }
      
      // Refresh the tasks list to ensure we're showing the current state
      if (selectedFeature) {
        await fetchTasksForFeature(selectedFeature.id);
      }
      
      // Show success message
      alert('Task deleted successfully!');
    } catch (error) {
      console.error('Error deleting task:', error);
      alert(`Failed to delete task: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

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
                  parent_feature_id: null,
                  title: '',
                  description: '',
                  status: 'todo',
                  priority: 'medium',
                  assignee_id: 0,
                  created_at: '',
                  updated_at: '',
                });
                setIsModalOpen(true);
                setModalType('featureGroup');
              }}
            >
              <span className={styles.plusIcon}>+</span> Add Feature Group
            </button>
            <button
              className={styles.createButton}
              onClick={() => {
                setEditingFeature({
                  id: 0,
                  project_id: Number(projectId),
                  parent_feature_id: undefined, // will be set in form
                  title: '',
                  description: '',
                  status: 'todo',
                  priority: 'medium',
                  assignee_id: 0,
                  created_at: '',
                  updated_at: '',
                });
                setIsModalOpen(true);
                setModalType('feature');
              }}
              style={{ marginLeft: 8 }}
            >
              <span className={styles.plusIcon}>+</span> Add Feature
            </button>
          </div>
        </div>

        <div className={styles.tableHeader}>
          <h2>Feature Groups</h2>
        </div>

        {features.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🔍</div>
            <p className={styles.emptyTitle}>No feature groups found</p>
            <p className={styles.emptyMessage}>Get started by adding your first feature group</p>
          </div>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.titleCell} onClick={() => handleSort('title')}>
                    Feature Group {sortField === 'title' && (sortDirection === 'asc' ? '↑' : '↓')}
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
                  <tr 
                    key={feature.id} 
                    className={styles.featureRow}
                  >
                    <td className={styles.titleCell}>
                      <div className={styles.featureInfo}>
                        <span className={styles.featureTitle}>
                          <span className={styles.featurePrefix}>FP-{feature.id}</span>{' '}
                          <span onClick={() => handleFeatureClick(feature)} className={styles.clickableTitle}>
                            {feature.title}
                          </span>
                        </span>
                        <div className={styles.featureMeta}>
                          {childFeatureCounts[feature.id] > 0 && (
                            <span className={styles.childFeatureCount}>
                              {childFeatureCounts[feature.id]} related feature{childFeatureCounts[feature.id] !== 1 ? 's' : ''}
                            </span>
                          )}
                          {taskCounts[feature.id] !== undefined && (
                            <span className={styles.taskCount}>
                              {taskCounts[feature.id]} task{taskCounts[feature.id] !== 1 ? 's' : ''}
                            </span>
                          )}
                          {feature.description && (
                            <span className={styles.featureDescription}>
                              {feature.description.length > 50
                                ? `${feature.description.substring(0, 50)}...`
                                : feature.description}
                            </span>
                          )}
                        </div>
                        {/* Display tags */}
                        {feature.tags && feature.tags.length > 0 && (
                          <div className={styles.featureTags}>
                            <TagList tags={feature.tags} navigateOnClick={true} />
                          </div>
                        )}
                        <button className={styles.editIconButton} onClick={() => handleEditFeature(feature)} title="Edit Feature">
                          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                        </button>
                      </div>
                    </td>
                    <td className={styles.statusCell}>
                      <span className={`${styles.statusBadge} ${styles[`status${feature.status.charAt(0).toUpperCase() + feature.status.slice(1)}`]}`}>
                        {feature.status === 'in_progress' ? 'In Progress' : 
                        feature.status.charAt(0).toUpperCase() + feature.status.slice(1)}
                      </span>
                    </td>
                    <td className={styles.priorityCell}>
                      <span className={`${styles.priorityBadge} ${styles[`priority${feature.priority.charAt(0).toUpperCase() + feature.priority.slice(1)}`]}`}>
                        {feature.priority.charAt(0).toUpperCase() + feature.priority.slice(1)}
                      </span>
                    </td>
                    <td className={styles.assigneeCell}>
                      {feature.assignee ? (
                        <div className={styles.assignee}>
                          <span className={styles.assigneeAvatar}>
                            {feature.assignee.username.charAt(0).toUpperCase()}
                          </span>
                          <span className={styles.assigneeName}>{feature.assignee.username}</span>
                        </div>
                      ) : (
                        <span className={styles.unassigned}>Unassigned</span>
                      )}
                    </td>
                    <td className={styles.actionsCell}>
                      <div className={styles.actionButtons}>
                        {/* Remove the 'Edit' button from feature cards */}
                        {/* <button
                          className={styles.actionButton}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditFeature(feature);
                          }}
                          title="Edit Feature"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                          </svg>
                        </button> */}
                      </div>
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
                <h3>{modalType === 'featureGroup' ? 'Create Feature Group' : 'Create Feature'}</h3>
                <button className={styles.closeButton} onClick={handleModalClose}>×</button>
              </div>
              <FeatureForm 
                feature={editingFeature}
                users={users}
                features={features}
                onClose={handleModalClose}
                onSubmit={editingFeature?.id ? handleSaveFeature : handleCreateFeature}
                modalType={modalType}
                categories={categories}
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
                        <option key="todo" value="todo">To Do</option>
                        <option key="in_progress" value="in_progress">In Progress</option>
                        <option key="done" value="done">Done</option>
                      </select>
                    </div>
                    
                    <div className={styles.formGroup}>
                      <label htmlFor="priority">Priority</label>
                      <select id="priority" name="priority" defaultValue="medium">
                        <option key="low" value="low">Low</option>
                        <option key="medium" value="medium">Medium</option>
                        <option key="high" value="high">High</option>
                      </select>
                    </div>
                    
                    <div className={styles.formGroup}>
                      <label htmlFor="assignee_id">Assignee</label>
                      <select id="assignee_id" name="assignee_id" defaultValue="">
                        <option key="unassigned" value="">Unassigned</option>
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

        {isTaskFormOpen && selectedFeature && (
          <div className={styles.modalOverlay} onClick={handleTaskFormClose}>
            <div className={styles.taskFormModal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>Add Task</h3>
                <button className={styles.closeButton} onClick={handleTaskFormClose}>×</button>
              </div>
              <div className={styles.modalContent}>
                <form onSubmit={handleTaskSubmit} className={styles.taskForm}>
                  <div className={styles.formGroup}>
                    <label htmlFor="task_name">Task Title*</label>
                    <input
                      type="text"
                      id="task_name"
                      name="task_name"
                      value={newTask.task_name}
                      onChange={handleTaskInputChange}
                      required
                      placeholder="Enter task title"
                    />
                  </div>
                  
                  <div className={styles.formGroup}>
                    <label htmlFor="description">Description</label>
                    <textarea
                      id="description"
                      name="description"
                      value={newTask.description}
                      onChange={handleTaskInputChange}
                      rows={3}
                      placeholder="Describe the task..."
                    />
                  </div>
                  
                  <div className={styles.formGroup}>
                    <label htmlFor="task_type">Task Type*</label>
                    <select
                      id="task_type"
                      name="task_type"
                      value={newTask.task_type}
                      onChange={handleTaskInputChange}
                      required
                    >
                      <option key="ui" value="UI">UI</option>
                      <option key="db" value="DB">DB</option>
                      <option key="backend" value="Backend">Backend</option>
                    </select>
                  </div>
                  
                  <div className={styles.formActions}>
                    <button 
                      type="button" 
                      className={styles.cancelButton}
                      onClick={handleTaskFormClose}
                    >
                      Cancel
                    </button>
                    <button type="submit" className={styles.saveButton}>
                      Create
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {isEditTaskFormOpen && editingTask && selectedFeature && (
          <div className={styles.modalOverlay} onClick={handleEditTaskFormClose}>
            <div className={styles.taskFormModal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>Edit Task</h3>
                <button className={styles.closeButton} onClick={handleEditTaskFormClose}>×</button>
              </div>
              <div className={styles.modalContent}>
                <form onSubmit={handleEditTaskSubmit} className={styles.taskForm}>
                  <div className={styles.formGroup}>
                    <label htmlFor="task_name">Task Title*</label>
                    <input
                      type="text"
                      id="task_name"
                      name="task_name"
                      value={editingTask.task_name}
                      onChange={handleEditTaskInputChange}
                      required
                      placeholder="Enter task title"
                    />
                  </div>
                  
                  <div className={styles.formGroup}>
                    <label htmlFor="description">Description</label>
                    <textarea
                      id="description"
                      name="description"
                      value={editingTask.description}
                      onChange={handleEditTaskInputChange}
                      rows={3}
                      placeholder="Describe the task..."
                    />
                  </div>
                  
                  <div className={styles.formGroup}>
                    <label htmlFor="task_type">Task Type*</label>
                    <select
                      id="task_type"
                      name="task_type"
                      value={editingTask.task_type}
                      onChange={handleEditTaskInputChange}
                      required
                    >
                      <option key="ui" value="UI">UI</option>
                      <option key="db" value="DB">DB</option>
                      <option key="backend" value="Backend">Backend</option>
                    </select>
                  </div>
                  
                  <div className={styles.formActions}>
                    <button 
                      type="button" 
                      className={styles.cancelButton}
                      onClick={handleEditTaskFormClose}
                    >
                      Cancel
                    </button>
                    <button type="submit" className={styles.saveButton}>
                      Update
                    </button>
                  </div>
                </form>
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
  features?: Feature[];
  onClose: () => void;
  onSubmit: (feature: Feature) => void;
  modalType: 'featureGroup' | 'feature';
  categories: string[];
}

const FeatureForm = ({ feature, users, features = [], onClose, onSubmit, modalType, categories }: FeatureFormProps) => {
  const [formData, setFormData] = useState<Feature | null>(feature);
  const [tagsInput, setTagsInput] = useState(feature?.tags_input || '');
  const [existingTags, setExistingTags] = useState<string[]>(feature?.tags?.map(tag => tag.tag_name) || []);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    // Initialize existingTags from feature tags if available
    if (feature?.tags) {
      setExistingTags(feature.tags.map(tag => tag.tag_name));
    }
    
    // Fetch all existing tags for autocomplete
    const fetchAllTags = async () => {
      try {
        const response = await TagsAPI.getAll();
        const tags = response.data as {tag_name: string}[];
        const uniqueTags = [...new Set(tags.map(tag => tag.tag_name))];
        setAllTags(uniqueTags);
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };
    
    fetchAllTags();
  }, [feature]);

  if (!formData) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    if (name === 'tags_input') {
      setTagsInput(value);
      
      // Show tag suggestions after typing at least 2 characters
      if (value.length >= 2) {
        const filtered = allTags.filter(tag => 
          tag.toLowerCase().includes(value.toLowerCase())
        );
        setTagSuggestions(filtered);
        setShowSuggestions(true);
      } else {
        setShowSuggestions(false);
      }
      return;
    }
    
    if (name === 'parent_feature_id') {
      if (value === "") {
        // If empty selection, set parent_feature_id to null
        setFormData({
          ...formData,
          parent_feature_id: null
        });
      } else {
        // Otherwise set it to the selected value
        setFormData({
          ...formData,
          parent_feature_id: parseInt(value, 10)
        });
      }
      return;
    }
    
    if (name === 'category') {
      setFormData({ ...formData, category: value });
      return;
    }
    
    setFormData({
      ...formData,
      [name]: name === 'assignee_id' ? Number(value) : value
    });
  };

  const handleTagSelect = (tag: string) => {
    setTagsInput(tag);
    setShowSuggestions(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    let newTags = tagsInput ? tagsInput.split(/[\s,;]+/).filter(Boolean) : [];
    
    // Combine existing tags and new tags input
    const combinedTags = [...existingTags, ...newTags].filter(Boolean);
    const uniqueTags = [...new Set(combinedTags)];
    const combinedTagsInput = uniqueTags.join(',');
    
    onSubmit({
      ...formData,
      tags_input: combinedTagsInput
    });
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setExistingTags(existingTags.filter(tag => tag !== tagToRemove));
  };

  // Filter out the current feature from the parent options to prevent circular references
  const availableParentFeatures = features.filter(f => f.id !== formData.id);

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
        <label htmlFor="parent_feature_id">Parent Feature</label>
        <select
          id="parent_feature_id"
          name="parent_feature_id"
          value={formData.parent_feature_id || ""}
          onChange={handleChange}
        >
          <option value="">None (Root Feature)</option>
          {availableParentFeatures.map((parentFeature) => (
            <option key={parentFeature.id} value={parentFeature.id}>
              FP-{parentFeature.id} {parentFeature.title}
            </option>
          ))}
        </select>
        <small className={styles.formHelp}>
          A feature can be a subfeature of another feature.
        </small>
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
      
      <div className={styles.formGroup}>
        <label htmlFor="category">Category</label>
        <select
          id="category"
          name="category"
          value={formData.category || ''}
          onChange={handleChange}
          required
        >
          <option value="" disabled>Select category</option>
          {categories.map((cat: string) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>
      
      <div className={styles.formGroup}>
        <label htmlFor="tags_input">Tags</label>
        <div className={styles.tagInputContainer}>
          <input
            type="text"
            id="tags_input"
            name="tags_input"
            value={tagsInput}
            onChange={handleChange}
            placeholder="Enter tags separated by space, comma or semicolon (e.g. 'api ui #backend')"
            autoComplete="off"
          />
          {showSuggestions && tagSuggestions.length > 0 && (
            <div className={styles.tagSuggestions}>
              {tagSuggestions.map((tag, index) => (
                <div 
                  key={index} 
                  className={styles.tagSuggestion}
                  onClick={() => handleTagSelect(tag)}
                >
                  {tag}
                </div>
              ))}
            </div>
          )}
        </div>
        <small className={styles.formHelp}>
          Tags help categorize features. Prefix with # is optional.
        </small>
        
        {existingTags.length > 0 && (
          <div className={styles.existingTags}>
            {existingTags.map((tag, index) => (
              <div key={index} className={styles.existingTag}>
                <span>{tag}</span>
                <button 
                  type="button" 
                  className={styles.removeTagButton}
                  onClick={() => handleRemoveTag(tag)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      
      <div className={styles.formGroup}>
        <label htmlFor="status">Status</label>
        <select
          id="status"
          name="status"
          value={formData.status}
          onChange={handleChange}
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
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
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