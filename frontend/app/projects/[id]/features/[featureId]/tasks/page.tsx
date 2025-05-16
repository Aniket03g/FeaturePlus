"use client";
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import API from '@/app/api/api';
import type { Feature, User } from '@/app/types';
import { Task } from '@/app/types/task';
import styles from './Tasks.module.css';

export default function FeatureTasksPage() {
  const params = useParams();
  const projectId = params?.id as string;
  const featureId = params?.featureId as string;
  const router = useRouter();
  
  const [feature, setFeature] = useState<Feature | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [newTask, setNewTask] = useState({
    task_name: '',
    description: '',
    task_type: 'UI'
  });
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch the feature details
        const featureRes = await API.get(`/features/${featureId}`);
        setFeature(featureRes.data);
        
        // Fetch tasks for this feature
        const tasksRes = await API.get(`/features/${featureId}/tasks`);
        setTasks(tasksRes.data);
        
        // Fetch users for assignee names
        const usersRes = await API.get('/users');
        setUsers(usersRes.data);
      } catch (error) {
        console.error('Error fetching feature data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [featureId]);

  const handleTaskFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (isEditingTask && editingTask) {
      setEditingTask({
        ...editingTask,
        [name]: value
      });
    } else {
      setNewTask({
        ...newTask,
        [name]: value
      });
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const taskData = {
        task_name: newTask.task_name,
        description: newTask.description,
        task_type: newTask.task_type,
        feature_id: Number(featureId)
      };
      
      const response = await API.post(`/features/${featureId}/tasks`, taskData);
      
      // Add the new task to the list
      setTasks([...tasks, response.data]);
      
      // Reset form and close it
      setNewTask({
        task_name: '',
        description: '',
        task_type: 'UI'
      });
      setIsAddingTask(false);
    } catch (error) {
      console.error('Error adding task:', error);
      alert('Failed to add task. Please try again.');
    }
  };

  const handleUpdateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask || typeof editingTask.id !== 'number') return;
    
    try {
      const taskData = {
        id: editingTask.id,
        task_name: editingTask.task_name,
        description: editingTask.description,
        task_type: editingTask.task_type,
        feature_id: Number(featureId)
      };
      
      await API.put(`/features/${featureId}/task/${editingTask.id}`, taskData);
      
      // Update the task in the list
      setTasks(tasks.map(task => 
        task.id === editingTask.id ? editingTask : task
      ));
      
      // Close the edit form
      setEditingTask(null);
      setIsEditingTask(false);
    } catch (error) {
      console.error('Error updating task:', error);
      alert('Failed to update task. Please try again.');
    }
  };

  const handleEditTask = (task: Task) => {
    setEditingTask({...task});
    setIsEditingTask(true);
  };

  const handleDeleteTask = async (taskId: number) => {
    try {
      await API.delete(`/features/${featureId}/task/${taskId}`);
      
      // Remove the task from the list
      setTasks(tasks.filter(task => task.id !== taskId));
      
      // Clear the confirmation
      setConfirmDeleteId(null);
    } catch (error) {
      console.error('Error deleting task:', error);
      alert('Failed to delete task. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.loadingIndicator}></div>
        <p>Loading tasks...</p>
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
            Feature Groups
          </Link>
          <span className={styles.breadcrumbSeparator}>/</span>
          {feature.parent_feature_id && (
            <>
              <Link 
                href={`/projects/${projectId}/features/${feature.parent_feature_id}`} 
                className={styles.breadcrumbLink}
              >
                {feature.parent_feature?.title || 'Parent Feature'}
              </Link>
              <span className={styles.breadcrumbSeparator}>/</span>
            </>
          )}
          <Link 
            href={`/projects/${projectId}/features/${featureId}`}
            className={styles.breadcrumbLink}
          >
            {feature.title}
          </Link>
          <span className={styles.breadcrumbSeparator}>/</span>
          <span className={styles.breadcrumbCurrent}>Tasks</span>
        </div>
        <button 
          className={styles.addButton}
          onClick={() => setIsAddingTask(true)}
        >
          + Add Task
        </button>
      </div>

      <div className={styles.featureDetails}>
        <h1 className={styles.featureTitle}>
          <span className={styles.featurePrefix}>FP-{feature.id}</span> {feature.title} Tasks
        </h1>
        {feature.description && (
          <p className={styles.featureDescription}>{feature.description}</p>
        )}
      </div>

      {isAddingTask && (
        <div className={styles.taskForm}>
          <h3>Add New Task</h3>
          <form onSubmit={handleAddTask}>
            <div className={styles.formGroup}>
              <label htmlFor="task_name">Task Name *</label>
              <input
                type="text"
                id="task_name"
                name="task_name"
                value={newTask.task_name}
                onChange={handleTaskFormChange}
                required
                placeholder="Enter task name"
              />
            </div>
            
            <div className={styles.formGroup}>
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                name="description"
                value={newTask.description}
                onChange={handleTaskFormChange}
                rows={3}
                placeholder="Describe the task..."
              />
            </div>
            
            <div className={styles.formGroup}>
              <label htmlFor="task_type">Task Type *</label>
              <select
                id="task_type"
                name="task_type"
                value={newTask.task_type}
                onChange={handleTaskFormChange}
                required
              >
                <option value="UI">UI</option>
                <option value="Backend">Backend</option>
                <option value="DB">DB</option>
              </select>
            </div>
            
            <div className={styles.formActions}>
              <button 
                type="button" 
                className={styles.cancelButton}
                onClick={() => setIsAddingTask(false)}
              >
                Cancel
              </button>
              <button type="submit" className={styles.submitButton}>
                Add Task
              </button>
            </div>
          </form>
        </div>
      )}

      {isEditingTask && editingTask && (
        <div className={styles.taskForm}>
          <h3>Edit Task</h3>
          <form onSubmit={handleUpdateTask}>
            <div className={styles.formGroup}>
              <label htmlFor="task_name">Task Name *</label>
              <input
                type="text"
                id="task_name"
                name="task_name"
                value={editingTask.task_name}
                onChange={handleTaskFormChange}
                required
                placeholder="Enter task name"
              />
            </div>
            
            <div className={styles.formGroup}>
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                name="description"
                value={editingTask.description}
                onChange={handleTaskFormChange}
                rows={3}
                placeholder="Describe the task..."
              />
            </div>
            
            <div className={styles.formGroup}>
              <label htmlFor="task_type">Task Type *</label>
              <select
                id="task_type"
                name="task_type"
                value={editingTask.task_type}
                onChange={handleTaskFormChange}
                required
              >
                <option value="UI">UI</option>
                <option value="Backend">Backend</option>
                <option value="DB">DB</option>
              </select>
            </div>
            
            <div className={styles.formActions}>
              <button 
                type="button" 
                className={styles.cancelButton}
                onClick={() => {
                  setIsEditingTask(false);
                  setEditingTask(null);
                }}
              >
                Cancel
              </button>
              <button type="submit" className={styles.submitButton}>
                Update Task
              </button>
            </div>
          </form>
        </div>
      )}

      <div className={styles.tasksSection}>
        <h2 className={styles.sectionTitle}>Tasks</h2>
        
        {tasks.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No tasks yet. Add some tasks to this feature.</p>
          </div>
        ) : (
          <div className={styles.tasksList}>
            {tasks.map(task => (
              <div key={task.id} className={styles.taskItem}>
                <div className={styles.taskHeader}>
                  <div className={styles.taskName}>{task.task_name}</div>
                  <div className={styles.taskType}>{task.task_type}</div>
                </div>
                {task.description && (
                  <div className={styles.taskDescription}>{task.description}</div>
                )}
                <div className={styles.taskActions}>
                  <button 
                    className={styles.editButton}
                    onClick={() => handleEditTask(task)}
                  >
                    Edit
                  </button>
                  {confirmDeleteId === task.id ? (
                    <div className={styles.confirmDelete} key="confirm-delete">
                      <span>Confirm?</span>
                      <button 
                        className={styles.confirmYesButton}
                        onClick={() => {
                          if (typeof task.id === 'number') {
                            handleDeleteTask(task.id);
                          }
                        }}
                      >
                        Yes
                      </button>
                      <button 
                        className={styles.confirmNoButton}
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button 
                      key="delete-button"
                      className={styles.deleteButton}
                      onClick={() => {
                        if (typeof task.id === 'number') {
                          setConfirmDeleteId(task.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
} 