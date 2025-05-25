'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import API from '@/api/api';

interface Task {
  id: number;
  task_type: string;
  task_name: string;
  description: string;
  feature_id: number;
  feature_title: string; // Added to include feature name
}

export default function TasksPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filteredTasks, setFilteredTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTaskType, setSelectedTaskType] = useState<'all' | string>('all');

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        setLoading(true);
        const response = await API.get(`/tasks/project/${projectId}`);
        setTasks(response.data);
        setFilteredTasks(response.data); // Initially show all tasks
      } catch (error) {
        console.error('Error fetching tasks:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchTasks();
  }, [projectId]);

  useEffect(() => {
    if (selectedTaskType === 'all') {
      setFilteredTasks(tasks);
    } else {
      setFilteredTasks(tasks.filter(task => task.task_type.toLowerCase() === selectedTaskType));
    }
  }, [tasks, selectedTaskType]);

  if (loading) {
    return <div className="p-6">Loading tasks...</div>;
  }

  const taskTypes = ['All', 'UI', 'Backend', 'DB']; // Define available task types

  return (
    <div className="p-6 bg-gray-50 min-h-screen max-w-4xl mx-l">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold">Project Tasks: {projectId}</h1>
      </div>

      {/* Filter Chips Row */}
      <div className="flex gap-2 mb-8">
        {taskTypes.map(type => (
          <button
            key={type}
            className={`px-4 py-1 rounded-full border text-sm font-medium transition ${
              (selectedTaskType === type.toLowerCase() || (selectedTaskType === 'all' && type === 'All')) ? 
              'bg-blue-600 text-white border-blue-600' : 
              'bg-white text-gray-700 border-gray-300 hover:bg-blue-50'
            }`}
            onClick={() => setSelectedTaskType(type.toLowerCase())}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Task List */}
      <div className="space-y-6">
        {filteredTasks.map(task => (
          <div key={task.id} className="bg-white rounded-lg shadow p-6 border border-gray-200">
            <div className="flex items-start gap-4 mb-2">
              <span className="flex-shrink-0 bg-gray-200 text-gray-800 px-2 py-1 rounded text-xs">{task.task_type}</span>
              <div className="flex-1">
                <h2 className="text-xl font-semibold text-blue-700">{task.task_name}</h2>
                <p className="text-gray-600 text-sm">Feature: {task.feature_title}</p>
              </div>
            </div>
            <div className="text-gray-700 text-base pl-12">
              {task.description || 'No description provided.'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
} 