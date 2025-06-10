'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import API from '@/api/api';
import { Task, TaskAttachment } from '@/app/types/task';
import { TaskCard } from '@/components/TaskCard';

export default function TasksPage() {
  const params = useParams();
  const projectId = params.projectId as string;
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
        setFilteredTasks(response.data);
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

  const handleEditTask = async (task: Task) => {
    // Implement edit task functionality
    console.log('Edit task:', task);
  };

  const handleDeleteTask = async (taskId: number) => {
    try {
      await API.delete(`/tasks/${taskId}`);
      setTasks(tasks.filter(task => task.ID !== taskId));
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };

  const handleAttachmentAdded = async (taskId: number, attachment: TaskAttachment) => {
    setTasks(tasks.map(task => {
      if (task.ID === taskId) {
        return {
          ...task,
          attachments: [...(task.attachments || []), attachment],
        };
      }
      return task;
    }));
  };

  const handleAttachmentDeleted = async (taskId: number, attachmentId: number) => {
    setTasks(tasks.map(task => {
      if (task.ID === taskId) {
        return {
          ...task,
          attachments: (task.attachments || []).filter(a => a.ID !== attachmentId),
        };
      }
      return task;
    }));
  };

  const taskTypes = ['All', 'UI', 'Backend', 'DB'];

  if (loading) {
    return <div className="p-6">Loading tasks...</div>;
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Tasks</h1>
        <div className="flex gap-2">
          {taskTypes.map((type) => (
            <button
              key={type}
              onClick={() => setSelectedTaskType(type.toLowerCase())}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                selectedTaskType === type.toLowerCase()
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {filteredTasks.map((task) => (
          <TaskCard
            key={task.ID}
            task={task}
            onEdit={handleEditTask}
            onDelete={handleDeleteTask}
            onAttachmentAdded={handleAttachmentAdded}
            onAttachmentDeleted={handleAttachmentDeleted}
          />
        ))}
        {filteredTasks.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            No tasks found
          </div>
        )}
      </div>
    </div>
  );
} 