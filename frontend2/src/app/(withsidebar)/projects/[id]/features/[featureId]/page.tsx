"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { FeaturesAPI, TasksAPI } from "@/api/api";
import { Modal } from "@/components/ui/modal";

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
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);
  const [selectedFeatureTags, setSelectedFeatureTags] = useState<Tag[]>([]);
  const [selectedFeatureTasks, setSelectedFeatureTasks] = useState<Task[]>([]);
  const [addTaskModalOpen, setAddTaskModalOpen] = useState(false);
  const [newTask, setNewTask] = useState({
    task_type: "UI",
    task_name: "",
    description: "",
  });
  const [addingTask, setAddingTask] = useState(false);
  const [addTaskError, setAddTaskError] = useState("");

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // Fetch feature group details
        const featureRes = await FeaturesAPI.getById(Number(featureId));
        setFeatureGroup(featureRes.data);

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

  const openFeatureModal = async (feature: Feature) => {
    setSelectedFeature(feature);
    setModalOpen(true);
    // Fetch tags and tasks for this feature
    const [tagsRes, tasksRes] = await Promise.all([
      FeaturesAPI.getTags(feature.id),
      TasksAPI.getByFeature(feature.id),
    ]);
    setSelectedFeatureTags(tagsRes.data.length > 0 ? tagsRes.data : [
      { id: 0, name: "ui" },
      { id: 1, name: "api" },
      { id: 2, name: "feature" },
    ]);
    setSelectedFeatureTasks(tasksRes.data);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedFeature(null);
    setSelectedFeatureTags([]);
    setSelectedFeatureTasks([]);
  };

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
      const res = await TasksAPI.createForFeature(Number(selectedFeature?.id), newTask);
      setSelectedFeatureTasks((prev) => [...prev, res.data]);
      closeAddTaskModal();
    } catch (err) {
      setAddTaskError("Failed to add task. Please try again.");
    } finally {
      setAddingTask(false);
    }
  };

  if (loading) {
    return <div className="p-6">Loading feature group...</div>;
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">{featureGroup?.title || "Feature Group"}</h1>
      {subfeatures.length === 0 ? (
        <p>No features found in this group.</p>
      ) : (
        <div className="space-y-6">
          {subfeatures.map((feature) => (
            <div
              key={feature.id}
              className="bg-white rounded-lg shadow p-6 border border-gray-200 flex items-start hover:bg-blue-50 transition cursor-pointer"
              onClick={() => openFeatureModal(feature)}
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

      {/* Modal for feature details */}
      <Modal isOpen={modalOpen} onClose={closeModal} className="max-w-lg p-8">
        {selectedFeature && (
          <>
            <div className="text-2xl font-bold mb-2 text-blue-700">{selectedFeature.title}</div>
            <div className="text-gray-700 mb-4">{selectedFeature.description || "No description provided."}</div>
            {/* Tags as chips below description */}
            <div className="mb-6 flex flex-wrap gap-2">
              {selectedFeatureTags.map((tag) => (
                <span key={tag.id} className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">{tag.name}</span>
              ))}
            </div>
            {/* Tasks list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold">Tasks</h2>
                <button
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-1.5 rounded transition"
                  onClick={openAddTaskModal}
                >
                  Add Task
                </button>
              </div>
              {selectedFeatureTasks.length === 0 ? (
                <div className="text-gray-400 text-sm">No tasks for this feature.</div>
              ) : (
                <ul className="space-y-4">
                  {selectedFeatureTasks.map((task) => (
                    <li key={task.id} className="border border-gray-200 rounded p-3 bg-gray-50">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-gray-500 font-medium min-w-[48px]">{task.task_type}</span>
                        <span className="font-semibold text-blue-700 text-base">{task.task_name}</span>
                      </div>
                      <div className="text-gray-700 text-sm mt-1 ml-[48px]">{task.description || "No description provided."}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </Modal>

      {/* Add Task Modal */}
      <Modal isOpen={addTaskModalOpen} onClose={closeAddTaskModal} className="max-w-md p-8">
        <div className="text-xl font-bold mb-4">Add Task</div>
        <form onSubmit={handleAddTask}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1" htmlFor="task_type">Task Type</label>
            <select
              id="task_type"
              name="task_type"
              className="w-full border rounded px-3 py-2 text-sm"
              value={newTask.task_type}
              onChange={handleNewTaskChange}
              required
            >
              <option value="UI">UI</option>
              <option value="DB">DB</option>
              <option value="Backend">Backend</option>
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1" htmlFor="task_name">Task Title</label>
            <input
              id="task_name"
              name="task_name"
              type="text"
              className="w-full border rounded px-3 py-2 text-sm"
              value={newTask.task_name}
              onChange={handleNewTaskChange}
              required
            />
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium mb-1" htmlFor="description">Description</label>
            <textarea
              id="description"
              name="description"
              className="w-full border rounded px-3 py-2 text-sm min-h-[80px]"
              value={newTask.description}
              onChange={handleNewTaskChange}
            />
          </div>
          {addTaskError && <div className="text-red-500 text-sm mb-2">{addTaskError}</div>}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              className="px-4 py-2 rounded border text-gray-700 bg-gray-100 hover:bg-gray-200"
              onClick={closeAddTaskModal}
              disabled={addingTask}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700"
              disabled={addingTask}
            >
              Add Task
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
} 