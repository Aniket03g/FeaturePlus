"use client";
import React, { useEffect, useState } from "react";
import API from "@/api/api";

interface Task {
  id: number;
  task_type: string;
  task_name: string;
  description: string;
  feature_id: number;
  feature_title: string;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        setLoading(true);
        const response = await API.get("/tasks");
        setTasks(response.data);
      } catch (error) {
        console.error("Error fetching tasks:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchTasks();
  }, []);

  // Helper to truncate description
  const truncate = (str: string, n: number) =>
    str.length > n ? str.slice(0, n) + "..." : str;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Tasks</h1>
      <div className="overflow-x-auto rounded-lg shadow bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tasks type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Task title</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Task description</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Feature</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {tasks.map((task) => (
              <tr key={task.id}>
                <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{task.task_type}</td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-700">{task.task_name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-700">{truncate(task.description, 40)}</td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-700">{task.feature_title}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="p-4 text-center text-gray-500">Loading tasks...</div>}
        {!loading && tasks.length === 0 && <div className="p-4 text-center text-gray-500">No tasks found.</div>}
      </div>
    </div>
  );
} 