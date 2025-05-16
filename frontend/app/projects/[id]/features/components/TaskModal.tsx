"use client";
import { useState, useEffect } from 'react';
import API from '@/app/api/api';
import type { Feature } from '@/app/types';
import { Task } from '@/app/types/task';
import styles from './TaskModal.module.css';

interface TaskModalProps {
  feature: Feature;
  isOpen: boolean;
  onClose: () => void;
}

export default function TaskModal({ feature, isOpen, onClose }: TaskModalProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTask, setNewTask] = useState({
    task_name: '',
    description: '',
    task_type: 'UI'
  });
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && feature) {
      fetchTasks();
    }
  }, [isOpen, feature]);

  const fetchTasks = async () => {
    if (!feature || !feature.id) return;
    
    try {
      setLoading(true);
      const response = await API.get(`/features/${feature.id}/tasks`);
      setTasks(response.data);
    } catch (error) {
      console.error('Error fetching tasks:', error);
    } finally {
      setLoading(false);
    }
  };

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
    if (!feature || !feature.id || isSubmitting) return;
    
    try {
      setIsSubmitting(true);
      const taskData = {
        task_name: newTask.task_name,
        description: newTask.description,
        task_type: newTask.task_type,
        feature_id: Number(feature.id)
      };
      
      const response = await API.post(`/features/${feature.id}/tasks`, taskData);
      
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
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Fix validation to properly check task properties
    if (!feature || !editingTask) {
      console.error("Missing required data for update task:", { 
        featureId: feature?.id, 
        editingTask: editingTask ? 'exists' : 'missing' 
      });
      return;
    }

    // Ensure we have a valid ID (either id or ID property)
    const taskId = editingTask.id || editingTask.ID;
    if (!taskId || typeof taskId !== 'number') {
      console.error("Invalid task ID:", { taskId, editingTask });
      return;
    }

    if (isSubmitting) {
      console.log("Already submitting, please wait");
      return;
    }
    
    try {
      setIsSubmitting(true);
      
      // Log the task data being sent
      console.log("Updating task:", editingTask);
      
      const taskData = {
        id: taskId,
        task_name: editingTask.task_name,
        description: editingTask.description || "",
        task_type: editingTask.task_type,
        feature_id: Number(feature.id)
      };
      
      // Make the API call
      const response = await API.put(`/features/${feature.id}/task/${taskId}`, taskData);
      
      console.log("Server response:", response.data);
      
      // Update the task in the list with the server data
      setTasks(prevTasks => 
        prevTasks.map(task => 
          (task.id === taskId || task.ID === taskId) 
            ? response.data 
            : task
        )
      );
      
      // Close the edit form
      setEditingTask(null);
      setIsEditingTask(false);
      
      // Refetch to ensure data consistency
      await fetchTasks();
      
    } catch (error) {
      console.error('Error updating task:', error);
      alert('Failed to update task. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditTask = (task: Task) => {
    console.log("Editing task:", task);
    setEditingTask({...task});
    setIsEditingTask(true);
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!feature?.id || isSubmitting) return;
    
    try {
      setIsSubmitting(true);
      console.log(`Deleting task ${taskId} from feature ${feature.id}`);
      
      // Make the API call
      await API.delete(`/features/${feature.id}/task/${taskId}`);
      
      // Remove the task from the list
      setTasks(prevTasks => prevTasks.filter(task => 
        (task.id !== taskId && task.ID !== taskId)
      ));
      
      // Clear the confirmation
      setConfirmDeleteId(null);
      
      // Refetch to ensure data consistency
      await fetchTasks();
      
    } catch (error) {
      console.error('Error deleting task:', error);
      alert('Failed to delete task. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>
            <span className={styles.featurePrefix}>FP-{feature.id}</span> {feature.title} Tasks
          </h2>
          <button className={styles.closeButton} onClick={onClose}>×</button>
        </div>
        
        <div className={styles.modalContent}>
          <div className={styles.taskActions}>
            <button 
              className={styles.addButton}
              onClick={() => setIsAddingTask(true)}
              disabled={isSubmitting}
            >
              + Add Task
            </button>
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
                    disabled={isSubmitting}
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
                    disabled={isSubmitting}
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
                    disabled={isSubmitting}
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
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className={styles.submitButton}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Adding...' : 'Add Task'}
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
                  <label htmlFor="edit_task_name">Task Name *</label>
                  <input
                    type="text"
                    id="edit_task_name"
                    name="task_name"
                    value={editingTask.task_name}
                    onChange={handleTaskFormChange}
                    required
                    placeholder="Enter task name"
                    disabled={isSubmitting}
                  />
                </div>
                
                <div className={styles.formGroup}>
                  <label htmlFor="edit_description">Description</label>
                  <textarea
                    id="edit_description"
                    name="description"
                    value={editingTask.description || ''}
                    onChange={handleTaskFormChange}
                    rows={3}
                    placeholder="Describe the task..."
                    disabled={isSubmitting}
                  />
                </div>
                
                <div className={styles.formGroup}>
                  <label htmlFor="edit_task_type">Task Type *</label>
                  <select
                    id="edit_task_type"
                    name="task_type"
                    value={editingTask.task_type}
                    onChange={handleTaskFormChange}
                    required
                    disabled={isSubmitting}
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
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className={styles.submitButton}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Updating...' : 'Update Task'}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className={styles.tasksContainer}>
            {loading ? (
              <div className={styles.loading}>
                <div className={styles.loadingIndicator}></div>
                <p>Loading tasks...</p>
              </div>
            ) : tasks.length === 0 ? (
              <div className={styles.emptyState}>
                <p>No tasks yet. Add some tasks to this feature.</p>
              </div>
            ) : (
              <div className={styles.tasksList}>
                {tasks.map(task => (
                  <div key={task.id || task.ID} className={styles.taskItem}>
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
                        disabled={isSubmitting}
                      >
                        Edit
                      </button>
                      {confirmDeleteId === (task.id || task.ID) ? (
                        <div className={styles.confirmDelete}>
                          <span>Confirm?</span>
                          <button 
                            className={styles.confirmYesButton}
                            onClick={() => {
                              const taskId = task.id || task.ID;
                              if (typeof taskId === 'number') {
                                handleDeleteTask(taskId);
                              }
                            }}
                            disabled={isSubmitting}
                          >
                            {isSubmitting ? 'Deleting...' : 'Yes'}
                          </button>
                          <button 
                            className={styles.confirmNoButton}
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={isSubmitting}
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button 
                          className={styles.deleteButton}
                          onClick={() => {
                            const taskId = task.id || task.ID;
                            if (typeof taskId === 'number') {
                              setConfirmDeleteId(taskId);
                            }
                          }}
                          disabled={isSubmitting}
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
      </div>
    </div>
  );
} 