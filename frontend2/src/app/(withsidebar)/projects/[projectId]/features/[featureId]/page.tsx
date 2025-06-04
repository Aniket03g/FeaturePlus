"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from 'next/link';
import API, { FeaturesAPI, TasksAPI, TagsAPI } from "@/api/api";
import { FiEdit2, FiTrash2 } from "react-icons/fi";
import { FeatureModal } from "@/components/FeatureEditCard";
import { Feature, User, Tag, Task } from "@/app/types";
import CheckLine from '@/icons/check-line.svg';

export default function FeatureGroupDetailPage() {
  const params = useParams();
  const projectId = params.projectId as string;
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
  const [isAddingTaskInline, setIsAddingTaskInline] = useState(false);
  const [newTaskForm, setNewTaskForm] = useState({
    task_type: "UI",
    task_name: "",
    description: "",
  });
  const [addFormLoading, setAddFormLoading] = useState(false);
  const [addFormError, setAddFormError] = useState("");
  const [editingField, setEditingField] = useState<{featureId: number, field: string} | null>(null);
  const [editedFeature, setEditedFeature] = useState<Feature | null>(null);
  const [editingTags, setEditingTags] = useState<string>('');
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

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

  useEffect(() => {
    TagsAPI.getAll().then(res => {
      const tags = res.data.map((t: any) => t.tag_name);
      setAllTags(tags);
    });
  }, []);

  const handleTagInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingTags(e.target.value);
    if (e.target.value.length >= 2) {
      const filtered = allTags.filter(tag => tag.toLowerCase().includes(e.target.value.toLowerCase()) && !selectedTags.includes(tag));
      setTagSuggestions(filtered);
      setShowTagSuggestions(true);
    } else {
      setShowTagSuggestions(false);
    }
  };

  const handleTagSelect = (tag: string) => {
    setSelectedTags([...selectedTags, tag]);
    setEditingTags('');
    setShowTagSuggestions(false);
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === ' ') && editingTags.trim()) {
      e.preventDefault();
      if (!selectedTags.includes(editingTags.trim())) {
        setSelectedTags([...selectedTags, editingTags.trim()]);
      }
      setEditingTags('');
      setShowTagSuggestions(false);
    }
  };

  const handleRemoveTag = (tag: string) => {
    setSelectedTags(selectedTags.filter(t => t !== tag));
  };

  useEffect(() => {
    if (editingField?.featureId === featureGroup?.id && editingField?.field === 'tags') {
      setSelectedTags((featureGroup?.tags ?? []).map(t => t.tag_name));
      setEditingTags('');
    }
  }, [editingField, featureGroup]);

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

  // Handler for inline add task form change
  const handleNewTaskFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setNewTaskForm({ ...newTaskForm, [e.target.name]: e.target.value });
  };

  // Handler for inline add task submit
  const handleNewTaskFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddFormLoading(true);
    setAddFormError("");
    try {
      const res = await TasksAPI.createForFeature(Number(featureGroup?.id), newTaskForm);
      setFeatureTasks((prev) => [res.data, ...prev]);
      setIsAddingTaskInline(false);
      setNewTaskForm({ task_type: "UI", task_name: "", description: "" });
    } catch (err) {
      setAddFormError("Failed to add task. Please try again.");
    } finally {
      setAddFormLoading(false);
    }
  };

  // Add logging to handleFieldEdit
  const handleFieldEdit = async (featureId: number, field: string, value: any) => {
    try {
      console.log('Starting field edit:', {
        featureId,
        field,
        value,
        editingField
      });
      
      const response = await FeaturesAPI.updateField(Number(featureId), field, value);
      console.log('Field edit response:', response);
      
      console.log('Fetching updated feature data...');
      const featureRes = await FeaturesAPI.getById(Number(featureId));
      console.log('Updated feature data:', featureRes);
      
      setFeatureGroup(featureRes.data);
      setEditingField(null);
      console.log('Field edit complete, editingField set to null');
    } catch (error: any) {
      console.log('Full error object:', error);
      console.log('Error response:', error?.response);
      console.log('Error request:', error?.request);
      console.log('Error config:', error?.config);
      console.error('Error updating feature:', error?.message);
    }
  };

  // Add logging to handleTagsEdit
  const handleTagsEdit = async (featureId: number, tags: string[] | string) => {
    try {
      // Accept either array or string for flexibility
      let tagArr: string[] = Array.isArray(tags) ? tags : tags.split(',');
      // Deduplicate and trim tags, remove empty
      tagArr = Array.from(new Set(tagArr.map(t => t.trim()).filter(Boolean)));
      const tagString = tagArr.join(',');
      // Send to backend as { tags: "a,c,d" }
      await API.put(`/features/${featureId}/tags`, { tags: tagString });
      // Refresh feature data
      const featureRes = await FeaturesAPI.getById(Number(featureId));
      setFeatureGroup(featureRes.data);
      setEditingField(null);
    } catch (error: any) {
      console.log('Full error object:', error);
      console.log('Error response:', error?.response);
      console.log('Error request:', error?.request);
      console.log('Error config:', error?.config);
      console.error('Error updating feature tags:', error?.message);
    }
  };

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
            {editingField?.featureId === featureGroup?.id && editingField?.field === 'title' ? (
              <input
                type="text"
                className="text-2xl font-bold text-blue-700 border rounded px-2 py-1 w-full"
                value={editedFeature?.title || featureGroup?.title || ''}
                onChange={(e) => setEditedFeature(prev => ({ ...prev!, title: e.target.value }))}
                onBlur={() => featureGroup?.id && handleFieldEdit(featureGroup.id, 'title', editedFeature?.title || '')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && featureGroup?.id) {
                    handleFieldEdit(featureGroup.id, 'title', editedFeature?.title || '');
                  }
                }}
                autoFocus
              />
            ) : (
              <h1 
                className="text-2xl font-bold text-blue-700 mb-0 cursor-text hover:bg-blue-50 px-2 py-1 rounded"
                onClick={() => {
                  if (featureGroup?.id) {
                    setEditingField({ featureId: featureGroup.id, field: 'title' });
                    setEditedFeature(featureGroup);
                  }
                }}
              >
                {featureGroup?.title || "Feature"}
              </h1>
            )}
          </div>
          {editingField?.featureId === featureGroup?.id && editingField?.field === 'description' ? (
            <textarea
              className="text-gray-700 text-base mb-2 w-full border rounded px-2 py-1"
              value={editedFeature?.description || featureGroup?.description || ''}
              onChange={(e) => setEditedFeature(prev => ({ ...prev!, description: e.target.value }))}
              onBlur={() => featureGroup?.id && handleFieldEdit(featureGroup.id, 'description', editedFeature?.description || '')}
              autoFocus
            />
          ) : (
            <div 
              className="text-gray-700 text-base mb-2 cursor-text hover:bg-blue-50 px-2 py-1 rounded"
              onClick={() => {
                if (featureGroup?.id) {
                  setEditingField({ featureId: featureGroup.id, field: 'description' });
                  setEditedFeature(featureGroup);
                }
              }}
            >
              {featureGroup?.description || 'No description provided.'}
            </div>
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
          {editingField?.featureId === featureGroup?.id && editingField?.field === 'tags' ? (
            <div className="flex flex-wrap gap-2 mt-2 relative items-center bg-gray-50 px-2 py-2 rounded border border-gray-200 shadow-sm" tabIndex={0}
              onBlur={e => {
                if (!e.currentTarget.contains(e.relatedTarget)) {
                  featureGroup?.id && handleTagsEdit(featureGroup.id, selectedTags);
                  setEditingField(null);
                }
              }}
              style={{ minHeight: 44 }}
            >
              {selectedTags.map((tag) => (
                <span key={tag} className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs flex items-center mb-1">
                  {'#' + tag}
                  <button type="button" className="ml-1 text-xs text-gray-500 hover:text-red-500" onClick={() => handleRemoveTag(tag)} tabIndex={-1}>&times;</button>
                </span>
              ))}
              <div className="relative flex items-center mb-1">
                <input
                  type="text"
                  className="border rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200"
                  value={editingTags}
                  onChange={handleTagInput}
                  onKeyDown={handleTagKeyDown}
                  placeholder="Add tag..."
                  autoFocus
                  style={{ minWidth: 120, marginRight: 4 }}
                  tabIndex={0}
                />
                {showTagSuggestions && tagSuggestions.length > 0 && (
                  <div className="absolute left-0 top-full mt-1 bg-white border rounded shadow z-50 w-48 max-h-40 overflow-auto">
                    {tagSuggestions.map((tag, idx) => (
                      <div
                        key={idx}
                        className="px-3 py-2 cursor-pointer hover:bg-blue-100"
                        onClick={() => handleTagSelect(tag)}
                      >
                        {tag}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <button
                className="ml-2 px-2 py-1 rounded flex items-center border border-gray-300 bg-white hover:bg-gray-100"
                onClick={() => {
                  featureGroup?.id && handleTagsEdit(featureGroup.id, selectedTags);
                  setEditingField(null);
                }}
                type="button"
                tabIndex={0}
                title="Save tags"
                style={{ height: 28 }}
              >
                <CheckLine width={18} height={18} style={{ color: 'black' }} />
              </button>
            </div>
          ) : (
            <div 
              className="flex flex-wrap gap-2 mt-2 cursor-text hover:bg-blue-50 px-2 py-1 rounded"
              onClick={() => {
                if (featureGroup?.id) {
                  setEditingField({ featureId: featureGroup.id, field: 'tags' });
                  setEditingTags((featureGroup?.tags ?? []).map(t => t.tag_name).join(', '));
                }
              }}
            >
              {featureGroup?.tags && featureGroup.tags.length > 0 ? (
                featureGroup.tags.map((tag) => (
                  <span key={tag.tag_name + '-' + tag.feature_id} className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">
                    {'#' + tag.tag_name}
                  </span>
                ))
              ) : (
                <span className="text-gray-500 text-sm">No tags</span>
              )}
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
            onClick={() => {
              setIsAddingTaskInline(true);
              setShowTaskForm(false);
              setIsEditingTask(false);
              setEditingTask(null);
              setFormError("");
            }}
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
        {/* Inline Add Task Card */}
        {isAddingTaskInline && (
          <div className="bg-white rounded-2xl shadow p-6 border border-blue-300 flex items-start gap-4 transition relative">
            <div className="absolute top-4 left-4">
              <select
                name="task_type"
                className="text-xs font-semibold px-2 py-1 rounded border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white text-gray-800 shadow-sm"
                value={newTaskForm.task_type}
                onChange={handleNewTaskFormChange}
                style={{ minWidth: 80 }}
              >
                <option value="UI">UI</option>
                <option value="DB">DB</option>
                <option value="Backend">Backend</option>
              </select>
            </div>
            <div className="flex-1 pl-20">
              <form onSubmit={handleNewTaskFormSubmit} className="space-y-2">
                <input
                  name="task_name"
                  type="text"
                  className="w-full border rounded px-3 py-2 text-base font-semibold text-blue-700"
                  value={newTaskForm.task_name}
                  onChange={handleNewTaskFormChange}
                  required
                  autoFocus
                  placeholder="Task name"
                />
                <textarea
                  name="description"
                  className="w-full border rounded px-3 py-2 text-base"
                  value={newTaskForm.description}
                  onChange={handleNewTaskFormChange}
                  placeholder="Describe the task..."
                />
                <div className="flex gap-2 mt-2">
                  <button
                    type="submit"
                    className="px-4 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700"
                    disabled={addFormLoading}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="px-4 py-2 rounded border text-gray-700 bg-gray-100 hover:bg-gray-200"
                    onClick={() => {
                      setIsAddingTaskInline(false);
                      setNewTaskForm({ task_type: "UI", task_name: "", description: "" });
                      setAddFormError("");
                    }}
                    disabled={addFormLoading}
                  >
                    Cancel
                  </button>
                </div>
                {addFormError && <div className="text-red-500 text-sm mt-1">{addFormError}</div>}
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
              const isEditing = isEditingTask && editingTask && editingTask.ID === taskID;
              return (
                <div key={taskID} className="bg-white rounded-2xl shadow p-6 border border-gray-200 flex items-start gap-4 hover:shadow-lg transition relative">
                  <div className="absolute top-4 left-4">
                    {isEditing ? (
                      <select
                        name="task_type"
                        className="text-xs font-semibold px-2 py-1 rounded border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 bg-white text-gray-800 shadow-sm"
                        value={taskForm.task_type}
                        onChange={handleTaskFormChange}
                        style={{ minWidth: 80 }}
                      >
                        <option value="UI">UI</option>
                        <option value="DB">DB</option>
                        <option value="Backend">Backend</option>
                      </select>
                    ) : (
                      <span className={`text-xs font-semibold px-2 py-1 rounded ${task.task_type === 'UI' ? 'bg-blue-100 text-blue-700' : task.task_type === 'DB' ? 'bg-purple-100 text-purple-700' : 'bg-yellow-100 text-yellow-700'}`}>{task.task_type}</span>
                    )}
                  </div>
                  <div className="flex-1 pl-20">
                    {isEditing ? (
                      <form onSubmit={handleTaskFormSubmit} className="space-y-2">
                        <input
                          name="task_name"
                          type="text"
                          className="w-full border rounded px-3 py-2 text-base font-semibold text-blue-700"
                          value={taskForm.task_name}
                          onChange={handleTaskFormChange}
                          required
                          autoFocus
                        />
                        <textarea
                          name="description"
                          className="w-full border rounded px-3 py-2 text-base"
                          value={taskForm.description}
                          onChange={handleTaskFormChange}
                          placeholder="Describe the task..."
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            type="submit"
                            className="px-4 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700"
                            disabled={formLoading}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="px-4 py-2 rounded border text-gray-700 bg-gray-100 hover:bg-gray-200"
                            onClick={closeTaskForm}
                            disabled={formLoading}
                          >
                            Cancel
                          </button>
                        </div>
                        {formError && <div className="text-red-500 text-sm mt-1">{formError}</div>}
                      </form>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-blue-700 text-lg cursor-pointer hover:underline">{task.task_name}</span>
                        </div>
                        <div className="text-gray-700 text-base mb-2">
                          {task.description || "No description provided."}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 ml-4 flex-shrink-0">
                    {!isEditing && (
                      <button
                        className="p-1 rounded hover:bg-blue-50 text-gray-500 hover:text-blue-600 transition"
                        onClick={() => {
                          setShowTaskForm(false); // Ensure modal is closed
                          setIsEditingTask(true);
                          setEditingTask(task);
                          setTaskForm({
                            task_type: task.task_type,
                            task_name: task.task_name,
                            description: task.description || "",
                          });
                          setFormError("");
                        }}
                        title="Edit"
                      >
                        <FiEdit2 size={18} />
                      </button>
                    )}
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
            <div
              key={feature.id}
              className="bg-white rounded-lg shadow p-6 border border-gray-200 flex items-center justify-between hover:bg-blue-50 transition cursor-pointer relative"
            >
              {/* Left section: Feature ID, Title, Description, and Tags */}
              <div className="flex-1 flex flex-col">
                <div className="flex items-center gap-4 mb-2">
                  <div className="flex-shrink-0 text-xs text-gray-400 font-mono">F-ID {feature.id}</div>
                  {editingField?.featureId === feature.id && editingField?.field === 'title' ? (
                    <input
                      type="text"
                      className="text-lg font-semibold text-blue-700 border rounded px-2 py-1"
                      value={feature.title}
                      onChange={(e) => {
                        const newSubfeatures = subfeatures.map(f => 
                          f.id === feature.id ? { ...f, title: e.target.value } : f
                        );
                        setSubfeatures(newSubfeatures);
                      }}
                      onBlur={() => feature.id && handleFieldEdit(feature.id, 'title', feature.title)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && feature.id) {
                          handleFieldEdit(feature.id, 'title', feature.title);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <span 
                      className="text-lg font-semibold text-blue-700 hover:bg-blue-100 px-2 py-1 rounded cursor-text"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingField({ featureId: feature.id, field: 'title' });
                      }}
                    >
                      {feature.title}
                    </span>
                  )}
                  {/* Tasks badge */}
                  <span className="ml-2 text-xs bg-gray-200 text-gray-700 rounded px-2 py-1">
                    {tasksCountMap[feature.id] || 0} tasks
                  </span>
                </div>
                {editingField?.featureId === feature.id && editingField?.field === 'description' ? (
                  <textarea
                    className="mt-1 text-gray-700 text-base w-full border rounded px-2 py-1"
                    value={feature.description}
                    onChange={(e) => {
                      const newSubfeatures = subfeatures.map(f => 
                        f.id === feature.id ? { ...f, description: e.target.value } : f
                      );
                      setSubfeatures(newSubfeatures);
                    }}
                    onBlur={() => feature.id && handleFieldEdit(feature.id, 'description', feature.description)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <div 
                    className="mt-1 text-gray-700 text-base hover:bg-blue-100 px-2 py-1 rounded cursor-text"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingField({ featureId: feature.id, field: 'description' });
                    }}
                  >
                    {feature.description || 'No description provided.'}
                  </div>
                )}
                {/* Tags as chips below description */}
                {editingField?.featureId === feature.id && editingField?.field === 'tags' ? (
                  <div className="mt-3">
                    <input
                      type="text"
                      className="w-full border rounded px-2 py-1"
                      value={(tagsMap[feature.id] ?? []).map(t => t.tag_name).join(', ')}
                      onChange={(e) => feature.id && handleTagsEdit(feature.id, e.target.value)}
                      onBlur={() => setEditingField(null)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Enter tags separated by commas"
                      autoFocus
                    />
                  </div>
                ) : (
                  <div 
                    className="mt-3 flex flex-wrap gap-2 hover:bg-blue-100 px-2 py-1 rounded cursor-text"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingField({ featureId: feature.id, field: 'tags' });
                    }}
                  >
                    {tagsMap[feature.id] && tagsMap[feature.id].length > 0 ? (
                      tagsMap[feature.id].map((tag) => (
                        <span key={tag.tag_name + '-' + tag.feature_id} className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">
                          {'#' + tag.tag_name}
                        </span>
                      ))
                    ) : (
                      <span className="text-gray-500 text-sm">No tags</span>
                    )}
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
                  title="Edit"
                >
                  <FiEdit2 size={18} />
                </button>
                <button
                  className="p-1 rounded hover:bg-red-50 text-gray-500 hover:text-red-600 transition"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteSubfeature(feature);
                  }}
                  title="Delete"
                >
                  <FiTrash2 size={18} />
                </button>
              </div>
              <div 
                className="absolute inset-0 cursor-pointer"
                onClick={() => {
                  console.log("Subfeature card clicked:", {
                    projectId,
                    featureId: feature.id,
                    editingField,
                    feature
                  });
                  if (!editingField?.featureId) {
                    console.log("Navigating to subfeature:", `/projects/${projectId}/features/${feature.id}`);
                    router.push(`/projects/${projectId}/features/${feature.id}`);
                  }
                }}
              />
            </div>
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