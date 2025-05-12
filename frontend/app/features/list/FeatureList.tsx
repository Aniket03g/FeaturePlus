"use client";
import { useState, useEffect } from 'react';
import API from '@/app/api/api';
import type { Feature, User } from '@/app/types';
import { SubFeature } from '@/app/types/subfeature';
import { Task } from '@/app/types/task';
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
        await Promise.all(
          featuresRes.data.map(async (feature: Feature) => {
            try {
              const subFeaturesResponse = await fetch(`http://localhost:8080/api/sub-features?feature_id=${feature.id}`);
              if (subFeaturesResponse.ok) {
                const subFeatures = await subFeaturesResponse.json();
                counts[feature.id] = subFeatures.length;
              }
              
              // Fetch task counts for each feature
              const tasksResponse = await fetch(`http://localhost:8080/api/features/${feature.id}/tasks`);
              if (tasksResponse.ok) {
                const tasks = await tasksResponse.json();
                taskCounts[feature.id] = tasks.length;
              }
            } catch (error) {
              console.error(`Error fetching data for feature ${feature.id}:`, error);
              counts[feature.id] = 0;
              taskCounts[feature.id] = 0;
            }
          })
        );
        setSubFeatureCounts(counts);
        setTaskCounts(taskCounts);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [projectId]);

  const handleFeatureClick = async (feature: Feature) => {
    setSelectedFeature(feature);
    setIsPopupOpen(true);
    
    // Reset any tasks-related state
    setConfirmDeleteTaskId(null);
    
    // Fetch tasks for this feature
    await fetchTasksForFeature(feature.id);
  };
  
  const fetchTasksForFeature = async (featureId: number) => {
    setLoadingTasks(true);
    try {
      const response = await fetch(`http://localhost:8080/api/features/${featureId}/tasks`);
      if (response.ok) {
        const tasks = await response.json();
        console.log(`Fetched ${tasks.length} tasks for feature ${featureId}`, tasks);
        setFeatureTasks(tasks);
      } else {
        console.error('Failed to fetch tasks for feature:', response.statusText);
        setFeatureTasks([]);
      }
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
      const taskData = {
        task_name: newTask.task_name,
        description: newTask.description,
        task_type: newTask.task_type,
        feature_id: selectedFeature.id,
        created_by_user: 1 // This should ideally be the current user's ID
      };
      
      console.log("Creating task with data:", taskData);
      
      const response = await fetch(`http://localhost:8080/api/features/${selectedFeature.id}/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(taskData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create task');
      }

      const createdTask = await response.json();
      
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
        feature_id: Number(selectedFeature.id),
        created_by_user: Number(editingTask.created_by_user) || 1
      };
      
      console.log("Updating task with data:", taskData);
      
      // Use the feature-specific task update endpoint with the correct path
      const response = await fetch(`http://localhost:8080/api/features/${selectedFeature.id}/task/${editingTask.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(taskData),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("API error response:", errorData);
        throw new Error(errorData.error || 'Failed to update task');
      }

      const updatedTask = await response.json();
      
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
      const url = `http://localhost:8080/api/features/${selectedFeature.id}/task/${taskId}`;
      console.log(`Deleting task ID: ${taskId} from feature ID: ${selectedFeature.id}`);
      console.log(`DELETE request to: ${url}`);
      
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      console.log("DELETE response status:", response.status);

      if (!response.ok) {
        let errorMessage = 'Failed to delete task';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
          console.error('Error response:', errorData);
        } catch (parseError) {
          console.error('Error parsing error response:', parseError);
        }
        throw new Error(errorMessage);
      }
      
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
                  title: '',
                  description: '',
                  status: 'todo',
                  priority: 'medium',
                  assignee_id: 0,
                  created_at: '',
                  updated_at: '',
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
                  <tr 
                    key={feature.id} 
                    className={`${styles[`row${feature.status}`]} ${styles.clickableRow}`}
                    onClick={() => handleFeatureClick(feature)}
                  >
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
                          <div className={styles.taskCount} title="Number of tasks">
                            {taskCounts[feature.id] || 0} tasks
                          </div>
                        </div>
                        {feature.description && (
                          <div className={styles.description}>{feature.description}</div>
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
                        onClick={(e) => handleEditFeature(feature, e)}
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

        {isPopupOpen && selectedFeature && (
          <div className={styles.modalOverlay} onClick={handlePopupClose}>
            <div className={styles.featurePopup} onClick={(e) => e.stopPropagation()}>
              <div className={styles.popupHeader}>
                <h3>{selectedFeature.title}</h3>
                <button className={styles.closeButton} onClick={handlePopupClose}>×</button>
              </div>
              <div className={styles.popupContent}>
                <div className={styles.featureDetails}>
                  <p className={styles.featureId}>FP-{selectedFeature.id}</p>
                  <div className={styles.featureStatusRow}>
                    <span className={`${styles.statusBadge} ${getStatusClass(selectedFeature.status)}`}>
                      {getStatusLabel(selectedFeature.status)}
                    </span>
                    <span className={`${styles.priorityBadge} ${getPriorityClass(selectedFeature.priority)}`}>
                      {selectedFeature.priority.charAt(0).toUpperCase() + selectedFeature.priority.slice(1)} Priority
                    </span>
                  </div>
                  <div className={styles.descriptionSection}>
                    <h4>Description</h4>
                    <p>{selectedFeature.description || 'No description provided.'}</p>
                  </div>
                  
                  <div className={styles.tasksSection}>
                    <div className={styles.tasksSectionHeader}>
                      <h4>Tasks</h4>
                      <button 
                        className={styles.addTaskButton}
                        onClick={handleAddTask}
                      >
                        Add Task
                      </button>
                    </div>
                    {loadingTasks ? (
                      <div className={styles.taskLoading}>Loading tasks...</div>
                    ) : featureTasks.length > 0 ? (
                      <ul className={styles.tasksList}>
                        {featureTasks.map(task => {
                          // Get task ID from either lowercase id or uppercase ID property
                          const taskId = task.id !== undefined ? task.id : task.ID;
                          return (
                            <li key={taskId} className={styles.taskItem} onClick={(e) => e.stopPropagation()}>
                              <div className={styles.taskHeader}>
                                <span className={styles.taskName}>{task.task_name}</span>
                                <span className={styles.taskType}>{task.task_type}</span>
                              </div>
                              {task.description && (
                                <p className={styles.taskDescription}>{task.description}</p>
                              )}
                              <div className={styles.taskActions}>
                                <button 
                                  className={styles.editTaskButton}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEditTask(task);
                                  }}
                                >
                                  Edit
                                </button>
                                <button 
                                  className={styles.deleteTaskButton}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    console.log("Delete button clicked, task object:", JSON.stringify(task, null, 2));
                                    
                                    if (taskId !== undefined && taskId !== null) {
                                      const numericTaskId = Number(taskId);
                                      console.log("Task ID after Number conversion:", numericTaskId);
                                      if (!isNaN(numericTaskId) && numericTaskId > 0) {
                                        handleDeleteTask(numericTaskId);
                                      } else {
                                        console.error("Invalid task ID value:", taskId);
                                      }
                                    } else {
                                      console.error("Cannot delete - task ID not found", task);
                                    }
                                  }}
                                >
                                  Delete
                                </button>
                              </div>
                              {taskId === confirmDeleteTaskId && (
                                <div className={styles.deleteConfirmation} onClick={(e) => e.stopPropagation()}>
                                  <p>Are you sure you want to delete this task?</p>
                                  <div className={styles.deleteActions}>
                                    <button 
                                      className={styles.cancelDeleteButton}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        console.log("Cancel delete button clicked");
                                        handleCancelDeleteTask();
                                      }}
                                    >
                                      Cancel
                                    </button>
                                    <button 
                                      className={styles.confirmDeleteButton}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        
                                        if (taskId !== undefined && taskId !== null) {
                                          const numericTaskId = Number(taskId);
                                          console.log("Task ID after Number conversion:", numericTaskId);
                                          if (!isNaN(numericTaskId) && numericTaskId > 0) {
                                            executeTaskDeletion(numericTaskId);
                                          } else {
                                            console.error("Invalid task ID value for deletion:", taskId);
                                            alert("Cannot delete - invalid task ID");
                                          }
                                        } else {
                                          console.error("Cannot delete - task ID not found", task);
                                          alert("Cannot delete - task ID not found");
                                        }
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <div className={styles.noTasks}>No tasks added yet</div>
                    )}
                  </div>
                  
                  <div className={styles.popupFooter}>
                    <button 
                      className={styles.editButton}
                      onClick={() => {
                        handleEditFeature(selectedFeature);
                        handlePopupClose();
                      }}
                    >
                      Edit Feature
                    </button>
                  </div>
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
            <option key="todo" value="todo">To Do</option>
            <option key="in_progress" value="in_progress">In Progress</option>
            <option key="done" value="done">Done</option>
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
            <option key="low" value="low">Low</option>
            <option key="medium" value="medium">Medium</option>
            <option key="high" value="high">High</option>
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
          <option key="unassigned" value={0}>Unassigned</option>
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