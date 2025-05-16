"use client";
import { useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import API from "@/app/api/api";
import type { Project } from "@/app/types/project";
import type { SubFeature } from "@/app/types/subfeature";
import type { Task } from "@/app/types/task";
import styles from "./SubFeatures.module.css";

interface SubFeatureWithFeatureInfo extends SubFeature {
  feature_title: string;
}

interface SubFeatureDetail {
  sub_feature: SubFeature;
  parent_feature: {
    id: number;
    title: string;
  };
  tasks: Task[];
}

const TASK_TYPES = ["UI", "DB", "Backend"];

const SubFeaturesPage = () => {
  const params = useParams();
  const projectId = params?.id as string;
  const [project, setProject] = useState<Project | null>(null);
  const [subFeatures, setSubFeatures] = useState<SubFeatureWithFeatureInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSubFeature, setSelectedSubFeature] = useState<SubFeatureDetail | null>(null);
  const [showPopup, setShowPopup] = useState(false);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    type: TASK_TYPES[0]
  });

  const fetchProject = useCallback(async () => {
    try {
      setLoading(true);
      const res = await API.get(`/projects/${projectId}`);
      setProject(res.data);
    } catch (error) {
      console.error("Failed to fetch project", error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const fetchSubFeatures = useCallback(async () => {
    try {
      setLoading(true);
      // API client automatically prepends /api, so we need to remove it from the URL
      const res = await API.get(`/sub-features/project?project_id=${projectId}`);
      setSubFeatures(res.data);
    } catch (error) {
      console.error("Failed to fetch sub-features", error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const fetchSubFeatureDetail = async (subFeatureId: number) => {
    try {
      const res = await API.get(`/sub-features/${subFeatureId}`);
      setSelectedSubFeature(res.data);
      setShowPopup(true);
    } catch (error) {
      console.error("Failed to fetch sub-feature details", error);
    }
  };

  const handleOpenAddTaskModal = () => {
    setShowAddTaskModal(true);
  };

  const handleCloseAddTaskModal = () => {
    setShowAddTaskModal(false);
    setNewTask({
      title: "",
      description: "",
      type: TASK_TYPES[0]
    });
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubFeature || !newTask.title.trim()) return;

    try {
      await API.post(`/sub-features/${selectedSubFeature.sub_feature.id}/tasks`, {
        task_type: newTask.type,
        task_name: newTask.title,
        description: newTask.description
      });

      // Refresh the sub-feature details
      fetchSubFeatureDetail(selectedSubFeature.sub_feature.id);
      handleCloseAddTaskModal();
    } catch (error) {
      console.error("Failed to add task", error);
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!selectedSubFeature) return;

    try {
      await API.delete(`/sub-features/${selectedSubFeature.sub_feature.id}/task/${taskId}`);
      
      // Refresh the sub-feature details
      fetchSubFeatureDetail(selectedSubFeature.sub_feature.id);
    } catch (error) {
      console.error("Failed to delete task", error);
    }
  };

  useEffect(() => {
    fetchProject();
    fetchSubFeatures();
  }, [fetchProject, fetchSubFeatures]);

  if (loading && !project) {
    return <div className={styles.loading}>Loading project...</div>;
  }

  if (!project) {
    return <div className={styles.error}>Project not found</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <h1>{project.name} Sub-features</h1>
          <button className={styles.addButton} onClick={() => console.log("Add new sub-feature")}>
            + Add Sub-feature
          </button>
        </div>
      </div>
      
      <div className={styles.tableContainer}>
        {subFeatures.length === 0 ? (
          <div className={styles.noData}>No sub-features found</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Parent Feature</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {subFeatures.map((subFeature) => (
                <tr key={subFeature.id}>
                  <td>
                    <span 
                      className={styles.featureTitle}
                      onClick={() => fetchSubFeatureDetail(subFeature.id)}
                    >
                      {subFeature.title}
                    </span>
                  </td>
                  <td>
                    <span className={`${styles.badge} ${styles[subFeature.status]}`}>
                      {subFeature.status === 'in_progress' 
                        ? 'In Progress' 
                        : subFeature.status.charAt(0).toUpperCase() + subFeature.status.slice(1)}
                    </span>
                  </td>
                  <td>
                    <span className={`${styles.badge} ${styles[subFeature.priority]}`}>
                      {subFeature.priority.charAt(0).toUpperCase() + subFeature.priority.slice(1)}
                    </span>
                  </td>
                  <td>
                    <div className={styles.featureRef}>
                      <span className={styles.featureId}>FP-{subFeature.feature_id}</span>
                      <span className={styles.featureTitle}>{subFeature.feature_title}</span>
                    </div>
                  </td>
                  <td>
                    <button 
                      className={styles.editButton}
                      onClick={() => console.log("Edit sub-feature", subFeature.id)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showPopup && selectedSubFeature && (
        <div className={styles.overlay} onClick={() => setShowPopup(false)}>
          <div className={styles.popup} onClick={(e) => e.stopPropagation()}>
            <button className={styles.closeButton} onClick={() => setShowPopup(false)}>×</button>
            
            <div className={styles.popupHeader}>
              <div className={styles.popupId}>#{selectedSubFeature.sub_feature.id}</div>
              <h2 className={styles.popupTitle}>{selectedSubFeature.sub_feature.title}</h2>
            </div>
            
            <div className={styles.popupContent}>
              <div className={styles.popupSection}>
                <h3 className={styles.popupSectionTitle}>Details</h3>
                
                <div className={styles.popupFieldRow}>
                  <div className={styles.popupFieldLabel}>Parent Feature</div>
                  <div className={styles.popupFieldValue}>
                    FP-{selectedSubFeature.parent_feature.id}: {selectedSubFeature.parent_feature.title}
                  </div>
                </div>
                
                <div className={styles.popupFieldRow}>
                  <div className={styles.popupFieldLabel}>Status</div>
                  <div className={styles.popupFieldValue}>
                    <span className={`${styles.badge} ${styles[selectedSubFeature.sub_feature.status]}`}>
                      {selectedSubFeature.sub_feature.status === 'in_progress' 
                        ? 'In Progress' 
                        : selectedSubFeature.sub_feature.status.charAt(0).toUpperCase() + selectedSubFeature.sub_feature.status.slice(1)}
                    </span>
                  </div>
                </div>
                
                <div className={styles.popupFieldRow}>
                  <div className={styles.popupFieldLabel}>Priority</div>
                  <div className={styles.popupFieldValue}>
                    <span className={`${styles.badge} ${styles[selectedSubFeature.sub_feature.priority]}`}>
                      {selectedSubFeature.sub_feature.priority.charAt(0).toUpperCase() + selectedSubFeature.sub_feature.priority.slice(1)}
                    </span>
                  </div>
                </div>
                
                <div className={styles.popupFieldRow}>
                  <div className={styles.popupFieldLabel}>Description</div>
                  <div className={styles.popupFieldValue}>
                    {selectedSubFeature.sub_feature.description || 'No description provided.'}
                  </div>
                </div>
              </div>
              
              <div className={styles.popupSection}>
                <div className={styles.taskSectionHeader}>
                  <h3 className={styles.popupSectionTitle}>Tasks</h3>
                  <button 
                    className={styles.addTaskButton}
                    onClick={handleOpenAddTaskModal}
                  >
                    Add Task
                  </button>
                </div>
                
                {selectedSubFeature.tasks.length === 0 ? (
                  <div className={styles.noTasks}>No tasks added yet</div>
                ) : (
                  <div className={styles.taskList}>
                    {selectedSubFeature.tasks.map((task) => (
                      <div key={task.ID} className={styles.taskItem}>
                        <div className={styles.taskName}>{task.task_name}</div>
                        <div className={styles.taskActions}>
                          <button 
                            className={styles.editButton}
                            onClick={() => console.log("Edit task", task.ID)}
                          >
                            Edit
                          </button>
                          <button 
                            className={styles.editButton}
                            onClick={() => task.ID && handleDeleteTask(task.ID)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddTaskModal && (
        <div className={styles.overlay} onClick={handleCloseAddTaskModal}>
          <div className={styles.taskModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.taskModalHeader}>
              <h2>Add Task</h2>
              <button className={styles.closeButton} onClick={handleCloseAddTaskModal}>×</button>
            </div>
            
            <div className={styles.taskModalContent}>
              <form onSubmit={handleCreateTask}>
                <div className={styles.inputGroup}>
                  <label htmlFor="taskTitle">Task Title<span className={styles.required}>*</span></label>
                  <input
                    type="text"
                    id="taskTitle"
                    className={styles.formInput}
                    placeholder="Enter task title"
                    value={newTask.title}
                    onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                    required
                  />
                </div>
                
                <div className={styles.inputGroup}>
                  <label htmlFor="taskDescription">Description</label>
                  <textarea
                    id="taskDescription"
                    className={styles.formTextarea}
                    placeholder="Describe the task..."
                    value={newTask.description}
                    onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                    rows={5}
                  />
                </div>
                
                <div className={styles.inputGroup}>
                  <label htmlFor="taskType">Task Type<span className={styles.required}>*</span></label>
                  <div className={styles.selectWrapper}>
                    <select
                      id="taskType"
                      className={styles.formSelect}
                      value={newTask.type}
                      onChange={(e) => setNewTask({...newTask, type: e.target.value})}
                    >
                      {TASK_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                </div>
                
                <div className={styles.formActions}>
                  <button 
                    type="button" 
                    className={styles.cancelButton}
                    onClick={handleCloseAddTaskModal}
                  >
                    Cancel
                  </button>
                  <button type="submit" className={styles.createButton}>
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubFeaturesPage; 