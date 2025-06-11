import React, { useState } from 'react';
import { Task, TaskAttachment } from '@/app/types/task';
import { FiEdit2, FiTrash2, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { TaskAttachments } from './TaskAttachments';
import { TaskComments } from './TaskComments';

interface TaskCardProps {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (taskId: number) => void;
  onAttachmentAdded: (taskId: number, attachment: TaskAttachment) => void;
  onAttachmentDeleted: (taskId: number, attachmentId: number) => void;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onEdit,
  onDelete,
  onAttachmentAdded,
  onAttachmentDeleted,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<number | undefined>();

  const getTaskTypeColor = (type: string): string => {
    switch (type.toLowerCase()) {
      case 'ui':
        return 'bg-purple-100 text-purple-800';
      case 'backend':
        return 'bg-blue-100 text-blue-800';
      case 'db':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <span className={`px-2 py-1 rounded text-xs font-medium ${getTaskTypeColor(task.task_type)}`}>
                {task.task_type}
              </span>
              <h3 className="text-base font-medium text-gray-900">{task.task_name}</h3>
            </div>
            <p className="mt-1 text-sm text-gray-600 line-clamp-2">
              {task.description}
            </p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={() => onEdit(task)}
              className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
              title="Edit task"
            >
              <FiEdit2 size={16} />
            </button>
            <button
              onClick={() => onDelete(task.ID)}
              className="p-1 text-gray-400 hover:text-red-600 transition-colors"
              title="Delete task"
            >
              <FiTrash2 size={16} />
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
              title={expanded ? "Show less" : "Show more"}
            >
              {expanded ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
            </button>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="text-sm text-gray-500">
              <div>Created: {new Date(task.created_at).toLocaleDateString()}</div>
              <div>Last updated: {new Date(task.updated_at).toLocaleDateString()}</div>
            </div>
            
            <TaskAttachments
              taskId={task.ID}
              attachments={task.attachments || []}
              onAttachmentAdded={(attachment) => onAttachmentAdded(task.ID, attachment)}
              onAttachmentDeleted={(attachmentId) => onAttachmentDeleted(task.ID, attachmentId)}
              onAttachmentSelected={(attachmentId) => setSelectedAttachmentId(attachmentId)}
            />

            <TaskComments
              taskId={task.ID}
              attachmentId={selectedAttachmentId}
            />
          </div>
        )}
      </div>
    </div>
  );
}; 