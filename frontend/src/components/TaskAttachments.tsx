import React, { useState, useRef, useEffect } from 'react';
import { TaskAttachment } from '@/app/types/task';
import { FiPaperclip, FiDownload, FiTrash2, FiEye } from 'react-icons/fi';
import { TasksAPI } from '@/api/api';

interface TaskAttachmentsProps {
  taskId: number;
  attachments: TaskAttachment[];
  onAttachmentAdded?: (attachment: TaskAttachment) => void;
  onAttachmentDeleted?: (attachmentId: number) => void;
  onAttachmentSelected?: (attachmentId: number | undefined) => void;
}

export const TaskAttachments: React.FC<TaskAttachmentsProps> = ({
  taskId,
  attachments,
  onAttachmentAdded,
  onAttachmentDeleted,
  onAttachmentSelected,
}) => {
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<number | undefined>();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const attachmentsContainer = document.getElementById('attachments-container');
      const commentsContainer = document.getElementById('comments-container');
      if (attachmentsContainer && !attachmentsContainer.contains(event.target as Node) &&
          commentsContainer && !commentsContainer.contains(event.target as Node)) {
        setSelectedAttachmentId(undefined);
        onAttachmentSelected?.(undefined);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onAttachmentSelected]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      alert(`File size must be less than 10MB. Current size: ${formatFileSize(file.size)}`);
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await TasksAPI.uploadAttachment(taskId, formData);
      if (response.data) {
        onAttachmentAdded?.(response.data);
      }
      // Clear the input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error: any) {
      console.error('Error uploading file:', error);
      const errorMessage = error.response?.data?.error || 'Failed to upload file';
      alert(errorMessage);
    } finally {
      setUploading(false);
    }
  };

  const handlePreview = async (attachment: TaskAttachment) => {
    try {
      const response = await TasksAPI.downloadAttachment(taskId, attachment.file_name);
      const blob = new Blob([response.data], { type: attachment.mime_type });
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl); // Clean up old URL
      }
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch (error) {
      console.error('Error previewing attachment:', error);
      alert('Failed to load preview');
    }
  };

  const handleDownload = async (fileName: string) => {
    try {
      const response = await TasksAPI.downloadAttachment(taskId, fileName);
      const blob = new Blob([response.data]);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading attachment:', error);
      alert('Failed to download attachment');
    }
  };

  const handleDelete = async (attachmentId: number) => {
    if (!window.confirm('Are you sure you want to delete this attachment?')) {
      return;
    }

    try {
      await TasksAPI.deleteAttachment(taskId, attachmentId);
      onAttachmentDeleted?.(attachmentId);
    } catch (error) {
      console.error('Error deleting attachment:', error);
      alert('Failed to delete attachment');
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div className="mt-4" id="attachments-container">
      <div className="flex items-center gap-2 mb-3">
        <FiPaperclip className="text-gray-500" />
        <span className="text-sm font-medium">Attachments</span>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          className="hidden"
          accept="image/*,application/pdf"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="ml-auto text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? 'Uploading...' : 'Add File'}
        </button>
      </div>

      {attachments.map((attachment) => (
        <div
          key={attachment.ID}
          className={`flex items-center justify-between p-2 rounded-lg ${
            selectedAttachmentId === attachment.ID ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
          }`}
          onClick={() => {
            setSelectedAttachmentId(
              selectedAttachmentId === attachment.ID ? undefined : attachment.ID
            );
            onAttachmentSelected?.(
              selectedAttachmentId === attachment.ID ? undefined : attachment.ID
            );
          }}
        >
          <div className="flex items-center gap-2 flex-1">
            <span className={`text-sm ${
              selectedAttachmentId === attachment.ID
                ? 'text-blue-600'
                : 'text-gray-700'
            }`}>
              {attachment.file_name}
            </span>
            <span className="text-xs text-gray-500">
              ({formatFileSize(attachment.file_size)})
            </span>
          </div>
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {attachment.mime_type?.startsWith('image/') && (
              <button
                onClick={() => handlePreview(attachment)}
                className="p-1 text-gray-500 hover:text-blue-600"
                title="Preview image"
              >
                <FiEye size={16} />
              </button>
            )}
            <button
              onClick={() => handleDownload(attachment.file_name)}
              className="p-1 text-gray-500 hover:text-gray-700"
              title="Download attachment"
            >
              <FiDownload size={16} />
            </button>
            <button
              onClick={() => handleDelete(attachment.ID)}
              className="p-1 text-gray-500 hover:text-red-600"
              title="Delete attachment"
            >
              <FiTrash2 size={16} />
            </button>
          </div>
        </div>
      ))}

      {/* Preview Modal */}
      {previewUrl && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => {
            setPreviewUrl(null);
            URL.revokeObjectURL(previewUrl); // Clean up the URL when closing
          }}
        >
          <div className="max-w-4xl max-h-[90vh] p-4">
            <img 
              src={previewUrl} 
              alt="Preview" 
              className="max-w-full max-h-full object-contain bg-white rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
};