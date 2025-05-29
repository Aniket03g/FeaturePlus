"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from 'next/link';
import API, { FeaturesAPI, TasksAPI } from "@/api/api";
import { FiEdit2, FiTrash2 } from "react-icons/fi";
import { FeatureModal } from "@/components/FeatureEditCard";
import { Feature, User, Tag, Task } from "@/app/types";

export default function FeatureGroupDetailPage() {
  const params = useParams();
  const projectId = params.id as string;
  const featureId = params.featureId as string;

  const [featureGroup, setFeatureGroup] = useState<Feature | null>(null);
  const [subfeatures, setSubfeatures] = useState<Feature[]>([]);
  const [tagsMap, setTagsMap] = useState<Record<number, Tag[]>>({});
  const [tasksCountMap, setTasksCountMap] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [addTaskModalOpen, setAddTaskModalOpen] = useState(false);
  const [newTask, setNewTask] = useState({
    task_type: "UI",
    task_name: "",
    description: "",
  });
  const [addingTask, setAddingTask] = useState(false);
  const [addTaskError, setAddTaskError] = useState("");
  const [featureTags, setFeatureTags] = useState<Tag[]>([]);
  const [featureTasks, setFeatureTasks] = useState<Task[]>([]);
  const [taskFilter, setTaskFilter] = useState<string>("All");
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [isEditingTask, setIsEditingTask] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskForm, setTaskForm] = useState({
    task_type: "UI",
    task_name: "",
    description: "",
  });
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [isSubfeatureModalOpen, setIsSubfeatureModalOpen] = useState(false);
  const [editingSubfeature, setEditingSubfeature] = useState<Feature | null>(null);
  const [users, setUsers] = useState<User[]>([]);

  const router = useRouter();

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // Fetch feature group details
        const featureRes = await FeaturesAPI.getById(Number(featureId));
        setFeatureGroup(featureRes.data);
        console.log("Feature data with potentially preloaded tags:", featureRes.data);

        // Fetch tasks for this feature
        const tasksRes = await TasksAPI.getByFeature(Number(featureId));
        setFeatureTasks(tasksRes.data);
        console.log("Fetched tasks:", tasksRes.data);

        // Log received task data to check for 'id'
        if (Array.isArray(tasksRes.data)) {
          tasksRes.data.forEach((task: any) => {
            console.log("Fetched task ID:", task.ID, "Task object:", task);
          });
        } else {
          console.log("Fetched tasks data is not an array:", tasksRes.data);
        }

        // Fetch subfeatures
        const subRes = await FeaturesAPI.getSubfeatures(Number(featureId));
        setSubfeatures(subRes.data);

        // Fetch tags and tasks for each subfeature
        const tagsPromises = subRes.data.map((f: Feature) => FeaturesAPI.getTags(f.id));
        const tasksPromises = subRes.data.map((f: Feature) => TasksAPI.getByFeature(f.id));
        const tagsResults = await Promise.all(tagsPromises);
        const tasksResults = await Promise.all(tasksPromises);

        const tagsMap: Record<number, Tag[]> = {};
        tagsResults.forEach((res, idx) => {
          tagsMap[subRes.data[idx].id] = res.data;
        });
        setTagsMap(tagsMap);

        const tasksCountMap: Record<number, number> = {};
        tasksResults.forEach((res, idx) => {
          tasksCountMap[subRes.data[idx].id] = res.data.length;
        });
        setTasksCountMap(tasksCountMap);

        // Fetch users for the assignee dropdown in the modal
        const usersRes = await API.get('/users'); // Assuming a /users endpoint exists
        setUsers(usersRes.data);

      } catch (err) {
        // handle error
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [featureId]);

  const openAddTaskModal = () => {
    setAddTaskModalOpen(true);
    setNewTask({ task_type: "UI", task_name: "", description: "" });
    setAddTaskError("");
  };

  const closeAddTaskModal = () => {
    setAddTaskModalOpen(false);
    setAddTaskError("");
  };

  const handleNewTaskChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setNewTask({ ...newTask, [e.target.name]: e.target.value });
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddingTask(true);
    setAddTaskError("");
    try {
      const res = await TasksAPI.createForFeature(Number(featureGroup?.id), newTask);
      // Assuming you want to update the tasks for the feature
      setSubfeatures((prev) => [...prev, res.data.feature]);
      closeAddTaskModal();
    } catch (err) {
      setAddTaskError("Failed to add task. Please try again.");
    } finally {
      setAddingTask(false);
    }
  };

  const openAddTaskForm = () => {
    setShowTaskForm(true);
    setIsEditingTask(false);
    setEditingTask(null);
    setTaskForm({ task_type: "UI", task_name: "", description: "" });
    setFormError("");
  };

  const openEditTaskForm = (task: Task) => {
    if (typeof task.ID !== 'number') {
      console.error("Attempted to edit task with invalid ID:", task);
      alert("Cannot edit this task due to missing ID.");
      return;
    }
    setShowTaskForm(true);
    setIsEditingTask(true);
    setEditingTask(task);
    setTaskForm({
      task_type: task.task_type,
      task_name: task.task_name,
      description: task.description,
    });
    setFormError("");
  };

  const closeTaskForm = () => {
    setShowTaskForm(false);
    setIsEditingTask(false);
    setEditingTask(null);
    setTaskForm({ task_type: "UI", task_name: "", description: "" });
    setFormError("");
  };

  const handleTaskFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setTaskForm({ ...taskForm, [e.target.name]: e.target.value });
  };

  const handleTaskFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setFormError("");
    try {
      if (isEditingTask && editingTask) {
        // Edit task
        if (typeof editingTask.ID !== 'number') {
          console.error("Invalid task ID for update:", editingTask.ID);
          setFormError("Failed to save task due to invalid ID.");
          setFormLoading(false);
          return;
        }
        await TasksAPI.updateTask(Number(featureGroup?.id), editingTask.ID, taskForm);
        setFeatureTasks((prev) => prev.map((t) => t.ID === editingTask.ID ? { ...t, ...taskForm } : t));
        closeTaskForm();
      } else {
        // Add task
        const res = await TasksAPI.createForFeature(Number(featureGroup?.id), taskForm);
        setFeatureTasks((prev) => [...prev, res.data]);

        // Log newly created task data to check for 'id'
        console.log("Newly created task data:", res.data);

        closeTaskForm();
      }
    } catch (err) {
      setFormError("Failed to save task. Please try again.");
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteTask = async (taskID: number) => {
    try {
      if (typeof taskID !== 'number') {
        console.error("Invalid task ID for deletion:", taskID);
        return;
      }
      await TasksAPI.deleteTask(Number(featureGroup?.id), taskID);
      setFeatureTasks((prev) => prev.filter((t) => t.ID !== taskID));
    } catch (err) {
      // Optionally show error
    }
  };

  const handleDeleteSubfeature = async (subfeature: Feature) => {
    if (!subfeature.id) return;
    
    if (window.confirm(`Are you sure you want to delete the subfeature "${subfeature.title}"?`)) {
      try {
        // Assuming the API endpoint for deleting a feature (which a subfeature is) is /features/:id
        await API.delete(`/features/${subfeature.id}`);
        // Update the subfeatures state by filtering out the deleted subfeature
        setSubfeatures(subfeatures.filter(f => f.id !== subfeature.id));
        // Optionally, update the main feature's subfeature count if displayed
        // You might need to refetch the main feature or update its count state.
      } catch (error) {
        console.error('Error deleting subfeature:', error);
        alert('Failed to delete subfeature. Please try again.');
      }
    }
  };

  const handleEditSubfeature = (subfeature: Feature) => {
    setEditingSubfeature(subfeature);
    setIsSubfeatureModalOpen(true);
  };

  const handleCloseSubfeatureModal = () => {
    setIsSubfeatureModalOpen(false);
    setEditingSubfeature(null);
  };

  const handleSaveSubfeature = async (updatedSubfeature: Feature) => {
    try {
      // Assuming the API endpoint for updating a feature (which a subfeature is) is PUT /features/:id
      await API.put(`/features/${updatedSubfeature.id}`, updatedSubfeature);
      // Update the subfeatures state with the updated subfeature
      setSubfeatures(subfeatures.map(f => f.id === updatedSubfeature.id ? updatedSubfeature : f));
      handleCloseSubfeatureModal();
      // Optionally, update the main feature view if needed
    } catch (error) {
      console.error('Error updating subfeature:', error);
      alert('Failed to update subfeature. Please try again.');
    }
  };

  // Compute filtered tasks
  const filteredTasks = taskFilter === "All"
    ? featureTasks
    : featureTasks.filter(task => {
        console.log(`Task Type: ${task.task_type}, Filter: ${taskFilter}`);
        return task.task_type.toLowerCase() === taskFilter.toLowerCase();
      });

  if (loading) {
    return <div className="p-6">Loading feature group...</div>;
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen max-w-4xl mx-auto">
      {/* Feature Info Section */}
      <div className="mb-8">
        <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
          <div className="flex items-center gap-4 mb-2">
            <span className="text-xs font-mono bg-gray-100 text-gray-500 rounded px-2 py-1">FP-{featureGroup?.id}</span>
            <h1 className="text-2xl font-bold text-blue-700 mb-0">{featureGroup?.title || "Feature"}</h1>
          </div>
          {featureGroup?.description && (
            <div className="text-gray-700 text-base mb-2">{featureGroup.description}</div>
          )}
          <div className="flex flex-wrap gap-2 mb-2">
            <span className="text-xs bg-gray-200 text-gray-700 rounded px-2 py-1">
              {featureGroup?.status?.replace("_", " ") || "-"}
            </span>
            {featureGroup?.priority && (
              <span className="text-xs bg-yellow-100 text-yellow-800 rounded px-2 py-1">
                {featureGroup.priority.charAt(0).toUpperCase() + featureGroup.priority.slice(1)}
              </span>
            )}
          </div>
          {/* Tags as chips */}
          {featureGroup?.tags && featureGroup.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
              {featureGroup.tags.map((tag) => (
                <span key={tag.tag_name + '-' + tag.feature_id} className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">{tag.tag_name}</span>
            ))}
          </div>
          )}
        </div>
      </div>

      {/* Tasks Section */}
      {featureGroup?.parent_feature_id !== null && (
      <div className="mb-8">
        <div className="flex items-center mb-4 gap-4">
          <h2 className="text-xl font-semibold mb-0">Tasks</h2>
          <button
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold text-base shadow hover:bg-blue-700 transition"
            onClick={openAddTaskForm}
          >
            <span className="text-lg">+</span> Add Task
          </button>
          <div className="flex gap-2 ml-4">
            {['All', 'DB', 'UI', 'Backend'].map(type => (
              <button
                key={type}
                className={`px-4 py-1 rounded-full border text-sm font-medium transition
                  ${taskFilter === type ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-blue-50'}`}
                onClick={() => setTaskFilter(type)}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
        {showTaskForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-10 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md relative">
              <button className="absolute top-2 right-2 text-gray-400 hover:text-gray-600" onClick={closeTaskForm}>&times;</button>
              <h2 className="text-xl font-bold mb-4">{isEditingTask ? "Edit Task" : "Add New Task"}</h2>
              <form onSubmit={handleTaskFormSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1" htmlFor="task_type">Task Type *</label>
                  <select
                    id="task_type"
                    name="task_type"
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={taskForm.task_type}
                    onChange={handleTaskFormChange}
                    required
                  >
                    <option value="UI">UI</option>
                    <option value="DB">DB</option>
                    <option value="Backend">Backend</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" htmlFor="task_name">Task Name *</label>
                  <input
                    id="task_name"
                    name="task_name"
                    type="text"
                    className="w-full border rounded px-3 py-2 text-sm"
                    value={taskForm.task_name}
                    onChange={handleTaskFormChange}
                    required
                    placeholder="Enter task name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" htmlFor="description">Description</label>
                  <textarea
                    id="description"
                    name="description"
                    className="w-full border rounded px-3 py-2 text-sm min-h-[80px]"
                    value={taskForm.description}
                    onChange={handleTaskFormChange}
                    placeholder="Describe the task..."
                  />
                </div>
                {formError && <div className="text-red-500 text-sm mb-2">{formError}</div>}
                <div className="flex justify-end gap-3 mt-4">
                  <button
                    type="button"
                    className="px-4 py-2 rounded border text-gray-700 bg-gray-100 hover:bg-gray-200"
                    onClick={closeTaskForm}
                    disabled={formLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700"
                    disabled={formLoading}
                  >
                    {isEditingTask ? "Save" : "Add Task"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        <div className="space-y-4">
          {filteredTasks.length === 0 ? (
            <div className="text-gray-400 text-sm">No tasks for this filter.</div>
          ) : (
            filteredTasks.map((task) => {
              const taskID = task.ID;
              return (
                <div key={taskID} className="bg-white rounded-2xl shadow p-6 border border-gray-200 flex items-start gap-4 hover:shadow-lg transition relative">
                  <div className="absolute top-4 left-4">
                    <span className={`text-xs font-semibold px-2 py-1 rounded ${task.task_type === 'UI' ? 'bg-blue-100 text-blue-700' : task.task_type === 'DB' ? 'bg-purple-100 text-purple-700' : 'bg-yellow-100 text-yellow-700'}`}>{task.task_type}</span>
                  </div>
                  <div className="flex-1 pl-20">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-blue-700 text-lg cursor-pointer hover:underline">{task.task_name}</span>
                    </div>
                    <div className="text-gray-700 text-base mb-2">
                      {task.description || "No description provided."}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 ml-4 flex-shrink-0">
                    <button
                      className="p-1 rounded hover:bg-blue-50 text-gray-500 hover:text-blue-600 transition"
                      onClick={() => openEditTaskForm(task)}
                      title="Edit"
                    >
                      <FiEdit2 size={18} />
                    </button>
                    <button
                      className="p-1 rounded hover:bg-red-50 text-gray-500 hover:text-red-600 transition"
                      onClick={() => { if (typeof taskID === 'number') handleDeleteTask(taskID); }}
                      title="Delete"
                    >
                      <FiTrash2 size={18} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      )}

      {/* Subfeatures Section (if needed) */}
      {subfeatures.length > 0 && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold mb-4">Features</h2>
          {subfeatures.map((feature) => (
            <Link key={feature.id} href={`/projects/${projectId}/features/${feature.id}`} className="block">
              <div
                className="bg-white rounded-lg shadow p-6 border border-gray-200 flex items-center justify-between hover:bg-blue-50 transition cursor-pointer"
              >
                {/* Left section: Feature ID, Title, Description, and Tags */}
                <div className="flex-1 flex flex-col">
                  <div className="flex items-center gap-4 mb-2">
                    <div className="flex-shrink-0 text-xs text-gray-400 font-mono">F-ID {feature.id}</div>
                    <span className="text-lg font-semibold text-blue-700">{feature.title}</span>
                    {/* Tasks badge */}
                    <span className="ml-2 text-xs bg-gray-200 text-gray-700 rounded px-2 py-1">
                      {tasksCountMap[feature.id] || 0} tasks
                    </span>
                  </div>
                  {feature.description && (
                    <div className="mt-1 text-gray-700 text-base">{feature.description}</div>
                  )}
                  {/* Tags as chips below description, show dummy if none */}
                  {tagsMap[feature.id] && tagsMap[feature.id].length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {tagsMap[feature.id].map((tag) => (
                          <span key={tag.tag_name + '-' + tag.feature_id} className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">{tag.tag_name}</span>
                      ))}
                    </div>
                  )}
                </div>
                {/* Right section: Action buttons */}
                <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                  <button
                    className="p-1 rounded hover:bg-blue-50 text-gray-500 hover:text-blue-600 transition"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEditSubfeature(feature);
                    }}
                    title="Edit Subfeature"
                  >
                    <FiEdit2 size={18} />
                  </button>
                  <button
                    className="p-1 rounded hover:bg-red-50 text-gray-500 hover:text-red-600 transition"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSubfeature(feature);
                    }}
                    title="Delete Subfeature"
                  >
                    <FiTrash2 size={18} />
                  </button>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Feature Edit Modal */}
      {isSubfeatureModalOpen && editingSubfeature && 'id' in editingSubfeature && (
        <FeatureModal
          isOpen={isSubfeatureModalOpen}
          feature={editingSubfeature}
          onClose={handleCloseSubfeatureModal}
          onSave={handleSaveSubfeature}
          users={users}
        />
      )}
    </div>
  );
} 