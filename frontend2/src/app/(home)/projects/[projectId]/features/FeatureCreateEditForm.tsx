"use client";
import { useState } from 'react';
import styles from './FeatureCard.module.css';
import { Feature, User } from '@/app/types';


interface FeatureCreateEditProps {
  project: Project;
  feature: Feature;
  featureGroups: Feature[];
  users: User[];
  onEdit: (feature: Feature) => void;
  onCreate: (feature: Feature) => void;
}

const FeatureCreateEditForm = ({project, feature, featureGroups, users, onEdit, onCreate}: FeatureCreateEditProps) => {

  const [featureFormLoading, setFeatureFormLoading] = useState(false);
  const [featureFormError, setFeatureFormError] = useState('');
  const [featureShowTagSuggestions, setFeatureShowTagSuggestions] = useState(false);
  const [featureSelectedTags, setFeatureSelectedTags] = useState<string[]>([]);

  const [featureForm, setFeatureForm] = useState({
    title: '',
    parent_feature_id: '',
    description: '',
    tags: '',
    status: 'todo',
    priority: 'medium',
    assignee_id: '',
  });


  const handleFeatureTagSelect = (tag: string) => {
    setFeatureSelectedTags([...featureSelectedTags, tag]);
    setFeatureForm({ ...featureForm, tags: '' });
    setFeatureShowTagSuggestions(false);
  };

  const handleFeatureTagInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFeatureForm({ ...featureForm, tags: e.target.value });
    if (e.target.value.length >= 2) {
      const filtered = featureAllTags.filter(tag => tag.toLowerCase().includes(e.target.value.toLowerCase()) && !featureSelectedTags.includes(tag));
      setFeatureTagSuggestions(filtered);
      setFeatureShowTagSuggestions(true);
    } else {
      setFeatureShowTagSuggestions(false);
    }
  };

  const handleFeatureTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === ' ') && featureForm.tags.trim()) {
      e.preventDefault();
      if (!featureSelectedTags.includes(featureForm.tags.trim())) {
        setFeatureSelectedTags([...featureSelectedTags, featureForm.tags.trim()]);
      }
      setFeatureForm({ ...featureForm, tags: '' });
      setFeatureShowTagSuggestions(false);
    }
  };

  const handleRemoveFeatureTag = (tag: string) => {
    setFeatureSelectedTags(featureSelectedTags.filter(t => t !== tag));
  };

  const handleFeatureFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeatureFormLoading(true);
    setFeatureFormError('');
    try {
      await API.post('/features', {
        project_id: Number(projectId),
        parent_feature_id: Number(featureForm.parent_feature_id),
        title: featureForm.title,
        description: featureForm.description,
        tags_input: featureSelectedTags.join(','),
        status: featureForm.status,
        priority: featureForm.priority,
        assignee_id: featureForm.assignee_id ? Number(featureForm.assignee_id) : 0,
      });
      setShowFeatureModal(false);
      setFeatureForm({
        title: '',
        parent_feature_id: '',
        description: '',
        tags: '',
        status: 'todo',
        priority: 'medium',
        assignee_id: '',
      });
      setFeatureSelectedTags([]);
      const response = await API.get(`/features/project/${projectId}?root_only=true`);
      setFeatures(response.data);
    } catch (err) {
      setFeatureFormError('Failed to create feature.');
    } finally {
      setFeatureFormLoading(false);
    }
  };

  const handleFeatureFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFeatureForm({ ...featureForm, [e.target.name]: e.target.value });
  };


  return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-10 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md relative">
            <button className="absolute top-2 right-2 text-gray-400 hover:text-gray-600" onClick={() => setShowFeatureModal(false)}>&times;</button>
            <h2 className="text-xl font-bold mb-4">Create Feature</h2>
            <form onSubmit={handleFeatureFormSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Title</label>
                <input
                  type="text"
                  name="title"
                  value={featureForm.title}
                  onChange={handleFeatureFormChange}
                  className="w-full border rounded px-3 py-2"
                  required
                  placeholder="Feature title"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Parent Feature</label>
                <select
                  name="parent_feature_id"
                  value={featureForm.parent_feature_id}
                  onChange={handleFeatureFormChange}
                  className="w-full border rounded px-3 py-2"
                  required
                >
                  <option value="" disabled>Select a feature group</option>
                  {featureGroups.map((fg) => (
                    <option key={fg.id} value={fg.id}>{fg.title}</option>
                  ))}
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  name="description"
                  value={featureForm.description}
                  onChange={handleFeatureFormChange}
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                  placeholder="Describe the feature..."
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Tags</label>
                <input
                  type="text"
                  name="tags"
                  value={featureForm.tags}
                  onChange={handleFeatureTagInput}
                  onKeyDown={handleFeatureTagKeyDown}
                  className="w-full border rounded px-3 py-2"
                  placeholder="Enter tags separated by space, comma, or semicolon"
                  autoComplete="off"
                />
                {featureShowTagSuggestions && featureTagSuggestions.length > 0 && (
                  <div className="absolute bg-white border rounded shadow mt-1 z-50 w-full">
                    {featureTagSuggestions.map((tag, idx) => (
                      <div
                        key={idx}
                        className="px-3 py-2 cursor-pointer hover:bg-blue-100"
                        onClick={() => handleFeatureTagSelect(tag)}
                      >
                        {tag}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 mt-2">
                  {featureSelectedTags.map((tag, idx) => (
                    <span key={idx} className="bg-gray-200 text-gray-800 px-2 py-1 rounded text-xs flex items-center">
                      {tag}
                      <button type="button" className="ml-1 text-xs text-gray-500 hover:text-red-500" onClick={() => handleRemoveFeatureTag(tag)}>&times;</button>
                    </span>
                  ))}
                </div>
                <div className="text-xs text-gray-500 mt-1">Tags help categorize features. Prefix with # is optional.</div>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Status</label>
                <select
                  name="status"
                  value={featureForm.status}
                  onChange={handleFeatureFormChange}
                  className="w-full border rounded px-3 py-2"
                  required
                >
                  <option value="todo">To Do</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Priority</label>
                <select
                  name="priority"
                  value={featureForm.priority}
                  onChange={handleFeatureFormChange}
                  className="w-full border rounded px-3 py-2"
                  required
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Assignee</label>
                <select
                  name="assignee_id"
                  value={featureForm.assignee_id}
                  onChange={handleFeatureFormChange}
                  className="w-full border rounded px-3 py-2"
                >
                  <option value="">Unassigned</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.username}</option>
                  ))}
                </select>
              </div>
              {featureFormError && <div className="text-red-500 text-sm mb-2">{featureFormError}</div>}
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  className="px-4 py-2 rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-100"
                  onClick={() => setShowFeatureModal(false)}
                  disabled={featureFormLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 shadow"
                  disabled={featureFormLoading}
                >
                  {featureFormLoading ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
  );
}

export default FeatureCreateEditForm;


