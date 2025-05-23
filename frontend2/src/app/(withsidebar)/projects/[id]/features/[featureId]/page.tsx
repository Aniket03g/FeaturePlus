"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FeaturesAPI, TasksAPI } from "@/api/api";
import { FiEdit2, FiTrash2 } from "react-icons/fi";

interface Feature {
  id: number;
  title: string;
  description?: string;
  status: string;
  priority?: string;
}

interface Tag {
  id: number;
  name: string;
}

interface Task {
  id: number;
  task_type: string;
  task_name: string;
  description: string;
  feature_id: number;
}

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

  const router = useRouter();

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // Fetch feature group details
        const featureRes = await FeaturesAPI.getById(Number(featureId));
        setFeatureGroup(featureRes.data);

        // Fetch tags for this feature
        const tagsRes = await FeaturesAPI.getTags(Number(featureId));
        setFeatureTags(tagsRes.data);

        // Fetch tasks for this feature
        const tasksRes = await TasksAPI.getByFeature(Number(featureId));
        setFeatureTasks(tasksRes.data);

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
        if (typeof editingTask.id === 'number' && editingTask.id > 0) {
          await TasksAPI.updateTask(Number(featureGroup?.id), editingTask.id, taskForm);
          setFeatureTasks((prev) => prev.map((t) => t.id === editingTask.id ? { ...t, ...taskForm } : t));
        }
      } else {
        const res = await TasksAPI.createForFeature(Number(featureGroup?.id), taskForm);
        if (res.data && typeof res.data.id === 'number' && res.data.id > 0) {
          setFeatureTasks((prev) => [...prev, res.data]);
        }
      }
      closeTaskForm();
    } catch (err) {
      setFormError("Failed to save task. Please try again.");
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    if (typeof taskId !== 'number' || taskId <= 0) return;
    try {
      await TasksAPI.deleteTask(Number(featureGroup?.id), taskId);
      setFeatureTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch (err) {
      // Optionally show error
    }
  };

  // Compute filtered tasks
  const filteredTasks = taskFilter === "All"
    ? featureTasks
    : featureTasks.filter(task => task.task_type.toLowerCase() === taskFilter.toLowerCase());

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
          <div className="flex flex-wrap gap-2 mt-2">
            {(featureTags.length > 0 ? featureTags : [
              { id: 0, name: "ui" },
              { id: 1, name: "api" },
              { id: 2, name: "feature" },
            ]).map((tag) => (
              <span key={tag.id} className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">{tag.name}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Tasks Section */}
      {featureTasks.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center mb-4 gap-4 justify-between">
            <h2 className="text-xl font-semibold mb-0">Tasks</h2>
            <div className="flex items-center gap-2 ml-auto">
              <button
                className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
                style={{ minWidth: 0, height: '2.25rem' }}
                onClick={openAddTaskForm}
              >
                + Add Task
              </button>
              <div className="flex gap-2 ml-2">
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
          </div>
          {showTaskForm && (
            <div className="mb-6 max-w-xl bg-white rounded-lg shadow p-6 border border-gray-200">
              <h2 className="text-lg font-semibold mb-4">{isEditingTask ? "Edit Task" : "Add New Task"}</h2>
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
          )}
          <div className="space-y-4">
            {filteredTasks.length === 0 ? (
              <div className="text-gray-400 text-sm">No tasks for this filter.</div>
            ) : (
              filteredTasks.map((task) => {
                const taskId = task.id;
                return (
                  <div key={taskId} className="bg-white rounded-lg shadow p-4 border border-gray-200">
                    <div className="flex items-center gap-2 mb-1 justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 font-medium min-w-[48px]">{task.task_type}</span>
                        <span className="font-semibold text-blue-700 text-base">{task.task_name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="p-1 rounded hover:bg-blue-50 text-gray-500 hover:text-blue-600 transition"
                          onClick={() => openEditTaskForm(task)}
                          title="Edit"
                        >
                          <FiEdit2 size={18} />
                        </button>
                        <button
                          className="p-1 rounded hover:bg-red-50 text-gray-500 hover:text-red-600 transition"
                          onClick={() => { if (typeof taskId === 'number') handleDeleteTask(taskId); }}
                          title="Delete"
                        >
                          <FiTrash2 size={18} />
                        </button>
                      </div>
                    </div>
                    <div className="text-gray-700 text-sm mt-1 ml-[48px]">{task.description || "No description provided."}</div>
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
              className="bg-white rounded-lg shadow p-6 border border-gray-200 flex items-start hover:bg-blue-50 transition cursor-pointer"
              onClick={() => router.push(`/projects/${projectId}/features/${feature.id}`)}
            >
              {/* Left: Feature ID */}
              <div className="flex-shrink-0 text-xs text-gray-400 font-mono mr-4 pt-1">F-ID {feature.id}</div>
              {/* Center: Title & Description */}
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold text-blue-700">{feature.title}</span>
                  {/* Tasks badge */}
                  <span className="ml-2 text-xs bg-gray-200 text-gray-700 rounded px-2 py-1">
                    {tasksCountMap[feature.id] || 0} tasks
                  </span>
                </div>
                <div className="mt-1 text-gray-700 text-base">
                  {feature.description || "No description provided."}
                </div>
                {/* Tags as chips below description, show dummy if none */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {(tagsMap[feature.id] && tagsMap[feature.id].length > 0
                    ? tagsMap[feature.id]
                    : [
                        { id: 0, name: "ui" },
                        { id: 1, name: "api" },
                        { id: 2, name: "feature" },
                      ]
                  ).map((tag) => (
                    <span key={tag.id} className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">{tag.name}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 