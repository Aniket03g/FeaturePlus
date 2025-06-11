import React, { useState, useEffect } from 'react';
import { FiMessageSquare, FiSend, FiTrash2 } from 'react-icons/fi';
import { TaskComment } from '@/app/types/task';
import { TasksAPI } from '@/api/api';

interface TaskCommentsProps {
  taskId: number;
  attachmentId?: number;
}

export const TaskComments: React.FC<TaskCommentsProps> = ({ taskId, attachmentId }) => {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  useEffect(() => {
    loadComments();
    // Get current user ID from localStorage
    const userJson = localStorage.getItem('user');
    if (userJson) {
      try {
        const user = JSON.parse(userJson);
        setCurrentUserId(user.id);
      } catch (e) {
        console.error('Error parsing user data:', e);
      }
    }
  }, [taskId, attachmentId]);

  const loadComments = async () => {
    try {
      const response = await TasksAPI.getTaskComments(taskId);
      setComments(response.data);
    } catch (error: any) {
      console.error('Error loading comments:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setLoading(true);
    try {
      const response = await TasksAPI.createComment(taskId, {
        content: newComment,
        attachment_id: attachmentId,
      });
      setComments([response.data, ...comments]);
      setNewComment('');
    } catch (error: any) {
      console.error('Error creating comment:', error);
      const errorMessage = error.response?.data?.error || 'Failed to create comment';
      alert(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (commentId: number) => {
    if (!window.confirm('Are you sure you want to delete this comment?')) {
      return;
    }

    try {
      await TasksAPI.deleteComment(commentId);
      setComments(comments.filter(comment => comment.id !== commentId));
    } catch (error: any) {
      console.error('Error deleting comment:', error);
      const errorMessage = error.response?.data?.error || 'Failed to delete comment';
      alert(errorMessage);
    }
  };

  return (
    <div className="mt-4" id="comments-container">
      <div className="flex items-center gap-2 mb-3">
        <FiMessageSquare className="text-gray-500" />
        <span className="text-sm font-medium">
          {attachmentId ? 'Comment on Attachment' : 'Comments'}
        </span>
      </div>

      {/* Comment Form */}
      <form onSubmit={handleSubmit} className="mb-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder={attachmentId ? "Comment on this attachment..." : "Write a comment..."}
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={loading}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="submit"
            disabled={loading || !newComment.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FiSend size={16} />
          </button>
        </div>
      </form>

      {/* Comments List */}
      <div className="space-y-3">
        {comments.map((comment) => (
          <div key={comment.id} className="bg-gray-50 rounded-lg p-3 group">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">
                  {comment.user?.username || 'Anonymous'}
                </span>
                <span className="text-xs text-gray-500">
                  {new Date(comment.created_at).toLocaleString()}
                </span>
              </div>
              {currentUserId === comment.user_id && (
                <button
                  onClick={() => handleDelete(comment.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600 transition-all"
                  title="Delete comment"
                >
                  <FiTrash2 size={16} />
                </button>
              )}
            </div>
            <p className="text-sm text-gray-700">{comment.content}</p>
            {comment.attachment && (
              <div className="mt-1 text-xs text-gray-500">
                Commented on: {comment.attachment.file_name}
              </div>
            )}
          </div>
        ))}
        {comments.length === 0 && (
          <div className="text-sm text-gray-500 italic">No comments yet</div>
        )}
      </div>
    </div>
  );
}; 