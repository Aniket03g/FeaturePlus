import React, { useState, useRef } from 'react';
import { TaskAttachment } from '@/app/types/task';
import { FiPaperclip, FiDownload, FiTrash2, FiEye } from 'react-icons/fi';
import API, { TasksAPI } from '@/api/api';

interface TaskAttachmentsProps {
  taskId: number;
  attachments: TaskAttachment[];
  onAttachmentAdded: (attachment: TaskAttachment) => void;
  onAttachmentDeleted: (attachmentId: number) => void;
}

export const TaskAttachments: React.FC<TaskAttachmentsProps> = ({
  taskId,
  attachments,
  onAttachmentAdded,
  onAttachmentDeleted,
}) => {
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      alert(`File size must be less than 10MB. Current size: ${formatFileSize(file.size)}`);
      return;
    }

    // Validate task ID
    if (!taskId || taskId <= 0) {
      console.error('Invalid task ID:', taskId);
      alert('Invalid task ID. Please make sure you are on a valid task.');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await TasksAPI.uploadAttachment(taskId, formData);
      if (!response.data) {
        throw new Error('No data received from server');
      }
      onAttachmentAdded(response.data);
    } catch (error: any) {
      console.error('Error uploading file:', error);
      console.error('Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        headers: error.response?.headers,
      });
      
      let errorMessage = 'Error uploading file: ';
      if (error.response?.data?.error) {
        errorMessage += error.response.data.error;
      } else if (error.message) {
        errorMessage += error.message;
      } else {
        errorMessage += 'Unknown error occurred';
      }
      
      alert(errorMessage);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handlePreview = async (attachment: TaskAttachment) => {
    try {
      // Only preview images
      if (!attachment.mime_type?.startsWith('image/')) {
        alert('Preview is only available for images');
        return;
      }

      const response = await TasksAPI.downloadAttachment(taskId, attachment.file_name);
      const url = URL.createObjectURL(new Blob([response.data]));
      setPreviewUrl(url);
    } catch (error: any) {
      console.error('Error previewing file:', error);
      alert(`Error previewing file: ${error.message}`);
    }
  };

  const handleDownload = async (attachment: TaskAttachment) => {
    try {
      const response = await TasksAPI.downloadAttachment(taskId, attachment.file_name);
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', attachment.file_name);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('Error downloading file:', error);
      console.error('Error response:', error.response?.data);
      alert(`Error downloading file: ${error.response?.data?.error || error.message}`);
    }
  };

  const handleDelete = async (attachmentId: number) => {
    try {
      await TasksAPI.deleteAttachment(taskId, attachmentId);
      onAttachmentDeleted(attachmentId);
    } catch (error: any) {
      console.error('Error deleting attachment:', error);
      console.error('Error response:', error.response?.data);
      alert(`Error deleting attachment: ${error.response?.data?.error || error.message}`);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-3">
        <FiPaperclip className="text-gray-500" />
        <span className="text-sm font-medium">Attachments</span>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="ml-auto text-sm px-3 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
        >
          {uploading ? 'Uploading...' : 'Add File'}
        </button>
      </div>
      
      {attachments.length > 0 ? (
        <div className="space-y-2">
          {attachments.map((attachment) => (
            <div
              key={`${attachment.ID}-${attachment.file_name}`}
              className="flex items-center justify-between p-2 rounded bg-gray-50"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-900">{attachment.file_name}</span>
                <span className="text-xs text-gray-500">
                  ({formatFileSize(attachment.file_size)})
                </span>
              </div>
              <div className="flex items-center gap-2">
                {attachment.mime_type?.startsWith('image/') && (
                  <button
                    onClick={() => handlePreview(attachment)}
                    className="p-1 text-gray-500 hover:text-blue-600 transition-colors"
                    title="Preview"
                  >
                    <FiEye size={16} />
                  </button>
                )}
                <button
                  onClick={() => handleDownload(attachment)}
                  className="p-1 text-gray-500 hover:text-blue-600 transition-colors"
                  title="Download"
                >
                  <FiDownload size={16} />
                </button>
                <button
                  onClick={() => handleDelete(attachment.ID)}
                  className="p-1 text-gray-500 hover:text-red-600 transition-colors"
                  title="Delete"
                >
                  <FiTrash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-gray-500 italic">No attachments yet</div>
      )}

      {/* Image Preview Modal */}
      {previewUrl && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setPreviewUrl(null)}>
          <div className="bg-white p-4 rounded-lg max-w-4xl max-h-[90vh] overflow-auto">
            <img src={previewUrl} alt="Preview" className="max-w-full h-auto" />
          </div>
        </div>
      )}
    </div>
  );
};