'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import API, { TagsAPI } from '@/api/api';
import Link from 'next/link';
import { Feature, User } from "@/app/types";
import { FeaturesAPI } from '@/api/api';

export default function FeaturesPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const [features, setFeatures] = useState<Feature[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [project, setProject] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showFeatureModal, setShowFeatureModal] = useState(false);
  const [groupForm, setGroupForm] = useState({ title: '', description: '', tags: '' });
  const [groupFormLoading, setGroupFormLoading] = useState(false);
  const [groupFormError, setGroupFormError] = useState('');
  const [featureForm, setFeatureForm] = useState({
    title: '',
    description: '',
    category: '',
    tags: '',
    status: 'todo',
    priority: 'medium',
    assignee_id: '',
  });
  const [featureFormLoading, setFeatureFormLoading] = useState(false);
  const [featureFormError, setFeatureFormError] = useState('');
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [featureAllTags, setFeatureAllTags] = useState<string[]>([]);
  const [featureTagSuggestions, setFeatureTagSuggestions] = useState<string[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<'all' | number>('all');
  const [featureGroups, setFeatureGroups] = useState<Feature[]>([]);
  const [childFeatures, setChildFeatures] = useState<Feature[]>([]);
  const [featureShowTagSuggestions, setFeatureShowTagSuggestions] = useState(false);
  const [featureSelectedTags, setFeatureSelectedTags] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const router = useRouter();
  const [editingFeatureId, setEditingFeatureId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    category: '',
    tags: '',
    status: 'todo',
    priority: 'medium',
  });
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagSuggestions, setEditTagSuggestions] = useState<string[]>([]);
  const [showEditTagSuggestions, setShowEditTagSuggestions] = useState(false);
  const [showInlineFeatureForm, setShowInlineFeatureForm] = useState(false);
  const [editingField, setEditingField] = useState<{featureId: number, field: string} | null>(null);

  useEffect(() => {
    const fetchFeatures = async () => {
      try {
        setLoading(true);
        // Fetch project config
        const [groupsRes, usersRes, projectRes] = await Promise.all([
          API.get(`/features/project/${projectId}?root_only=true`),
          API.get('/users'),
          API.get(`/projects/${projectId}`),
        ]);
        setFeatureGroups(groupsRes.data as Feature[]);
        setUsers(usersRes.data);
        setProject(projectRes.data);
        // Extract categories from config
        if (projectRes.data && projectRes.data.config && Array.isArray(projectRes.data.config.feature_category)) {
          setCategories(projectRes.data.config.feature_category);
        }
        // Fetch all features for this project
        const allFeaturesRes = await API.get(`/features/project/${projectId}`);
        setFeatures(allFeaturesRes.data as Feature[]);
      } catch (error) {
        console.error('Error fetching features or users:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchFeatures();
  }, [projectId]);

  useEffect(() => {
    TagsAPI.getAll().then(res => {
      const tags = res.data.map((t: any) => t.tag_name);
      setAllTags(tags);
      setFeatureAllTags(tags);
    });
  }, []);

  // Filter child features based on selected group
  useEffect(() => {
    if (selectedGroupId === 'all') {
      setChildFeatures(features);
    } else {
      setChildFeatures(features.filter(f => f.parent_feature_id === selectedGroupId));
    }
  }, [selectedGroupId, features]);

  const handleGroupFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setGroupForm({ ...groupForm, [e.target.name]: e.target.value });
  };

  const handleGroupTagInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setGroupForm({ ...groupForm, tags: e.target.value });
    if (e.target.value.length >= 2) {
      const filtered = allTags.filter(tag => tag.toLowerCase().includes(e.target.value.toLowerCase()) && !selectedTags.includes(tag));
      setTagSuggestions(filtered);
      setShowTagSuggestions(true);
    } else {
      setShowTagSuggestions(false);
    }
  };

  const handleGroupTagSelect = (tag: string) => {
    setSelectedTags([...selectedTags, tag]);
    setGroupForm({ ...groupForm, tags: '' });
    setShowTagSuggestions(false);
  };

  const handleGroupTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === ' ') && groupForm.tags.trim()) {
      e.preventDefault();
      if (!selectedTags.includes(groupForm.tags.trim())) {
        setSelectedTags([...selectedTags, groupForm.tags.trim()]);
      }
      setGroupForm({ ...groupForm, tags: '' });
      setShowTagSuggestions(false);
    }
  };

  const handleRemoveGroupTag = (tag: string) => {
    setSelectedTags(selectedTags.filter(t => t !== tag));
  };

  const handleGroupFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGroupFormLoading(true);
    setGroupFormError('');
    try {
      await API.post('/features', {
        project_id: Number(projectId),
        parent_feature_id: null,
        title: groupForm.title,
        description: groupForm.description,
        tags_input: selectedTags.join(','),
        status: 'todo',
        priority: 'medium',
        assignee_id: 0
      });
      setShowGroupModal(false);
      setGroupForm({ title: '', description: '', tags: '' });
      setSelectedTags([]);
      // Fetch and update both featureGroups and features
      const [groupsRes, allFeaturesRes] = await Promise.all([
        API.get(`/features/project/${projectId}?root_only=true`),
        API.get(`/features/project/${projectId}`)
      ]);
      setFeatureGroups(groupsRes.data as Feature[]);
      setFeatures(allFeaturesRes.data as Feature[]);
    } catch (err) {
      setGroupFormError('Failed to create feature group.');
    } finally {
      setGroupFormLoading(false);
    }
  };

  const handleFeatureFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFeatureForm({ ...featureForm, [e.target.name]: e.target.value });
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

  const handleFeatureTagSelect = (tag: string) => {
    setFeatureSelectedTags([...featureSelectedTags, tag]);
    setFeatureForm({ ...featureForm, tags: '' });
    setFeatureShowTagSuggestions(false);
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
        title: featureForm.title,
        description: featureForm.description,
        category: featureForm.category,
        tags_input: featureSelectedTags.join(','),
        status: featureForm.status,
        priority: featureForm.priority,
        assignee_id: featureForm.assignee_id ? Number(featureForm.assignee_id) : 0,
      });
      setShowFeatureModal(false);
      setFeatureForm({
        title: '',
        description: '',
        category: '',
        tags: '',
        status: 'todo',
        priority: 'medium',
        assignee_id: '',
      });
      setFeatureSelectedTags([]);
      const [groupsRes, allFeaturesRes] = await Promise.all([
        API.get(`/features/project/${projectId}?root_only=true`),
        API.get(`/features/project/${projectId}`)
      ]);
      setFeatureGroups(groupsRes.data as Feature[]);
      setFeatures(allFeaturesRes.data as Feature[]);
    } catch (err) {
      setFeatureFormError('Failed to create feature.');
    } finally {
      setFeatureFormLoading(false);
    }
  };

  const filteredFeatures = selectedCategory === 'All'
    ? features
    : features.filter(f => 'category' in f && f.category === selectedCategory);

  // Add new handlers for inline editing
  const handleFieldEdit = async (featureId: number, field: string, value: string) => {
    try {
      await FeaturesAPI.updateField(featureId, field, value);
      const response = await API.get(`/features/project/${projectId}`);
      setFeatures(response.data);
      setEditingField(null);
    } catch (error) {
      console.error('Error updating feature:', error);
    }
  };

  const handleTagsEdit = async (featureId: number, tags: string) => {
    try {
      await FeaturesAPI.updateField(featureId, 'tags', tags);
      const response = await API.get(`/features/project/${projectId}`);
      setFeatures(response.data);
      setEditingField(null);
    } catch (error) {
      console.error('Error updating feature tags:', error);
    }
  };

  if (loading) {
    return <div className="p-6">Loading features...</div>;
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen max-w-4xl mx-l">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold">Project[{projectId}]: {project?.name} </h1>
        <div className="flex gap-2">
          <button
            className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700 transition"
            onClick={() => setShowInlineFeatureForm(true)}
          >
            + Add Feature
          </button>
        </div>
      </div>
      {/* Filter Chips Row */}
      <div className="flex gap-2 mb-8">
        <button
          className={`px-4 py-1 rounded-full border text-sm font-medium transition ${selectedCategory === 'All' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-blue-50'}`}
          onClick={() => setSelectedCategory('All')}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            className={`px-4 py-1 rounded-full border text-sm font-medium transition ${selectedCategory === cat ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-blue-50'}`}
            onClick={() => setSelectedCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>
      {/* Inline Feature Form */}
      {showInlineFeatureForm && (
        <div className="bg-white rounded-lg shadow p-6 border border-gray-200 mb-6">
          <h2 className="text-xl font-bold mb-4">Create Feature</h2>
          <form onSubmit={async (e) => {
            e.preventDefault();
            setFeatureFormLoading(true);
            setFeatureFormError('');
            try {
              await API.post('/features', {
                project_id: Number(projectId),
                title: featureForm.title,
                description: featureForm.description,
                category: featureForm.category,
                tags_input: featureSelectedTags.join(','),
                status: featureForm.status,
                priority: featureForm.priority,
                assignee_id: featureForm.assignee_id ? Number(featureForm.assignee_id) : 0,
              });
              setShowInlineFeatureForm(false);
              setFeatureForm({
                title: '',
                description: '',
                category: '',
                tags: '',
                status: 'todo',
                priority: 'medium',
                assignee_id: '',
              });
              setFeatureSelectedTags([]);
              const [groupsRes, allFeaturesRes] = await Promise.all([
                API.get(`/features/project/${projectId}?root_only=true`),
                API.get(`/features/project/${projectId}`)
              ]);
              setFeatureGroups(groupsRes.data as Feature[]);
              setFeatures(allFeaturesRes.data as Feature[]);
            } catch (err) {
              setFeatureFormError('Failed to create feature.');
            } finally {
              setFeatureFormLoading(false);
            }
          }}>
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
              <label className="block text-sm font-medium mb-1">Feature Category</label>
              <select
                name="category"
                value={featureForm.category}
                onChange={handleFeatureFormChange}
                className="w-full border rounded px-3 py-2"
                required
              >
                <option value="" disabled>Select a category</option>
                {categories.map((cat: string) => (
                  <option key={cat} value={cat}>{cat}</option>
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
                onClick={() => {
                  setShowInlineFeatureForm(false);
                  setFeatureForm({
                    title: '',
                    description: '',
                    category: '',
                    tags: '',
                    status: 'todo',
                    priority: 'medium',
                    assignee_id: '',
                  });
                  setFeatureSelectedTags([]);
                }}
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
      )}
      {/* Feature List */}
      <div className="space-y-6">
        {filteredFeatures.map(item => {
          const isChild = item.parent_feature_id !== null && item.parent_feature_id !== undefined;
          const isEditing = editingFeatureId === item.id;
          if (isEditing) {
            return (
              <div key={item.id} className="bg-white rounded-lg shadow p-6 border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <input
                    className="text-xl font-semibold text-blue-700 w-full border-b border-gray-300 focus:outline-none focus:border-blue-500"
                    value={editForm.title}
                    onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                    placeholder="Feature title"
                  />
                </div>
                <textarea
                  className="w-full border rounded px-3 py-2 mb-2"
                  rows={2}
                  value={editForm.description}
                  onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="Description"
                />
                <div className="mb-2">
                  <label className="block text-sm font-medium mb-1">Feature Category</label>
                  <select
                    className="w-full border rounded px-3 py-2"
                    value={editForm.category}
                    onChange={e => setEditForm({ ...editForm, category: e.target.value })}
                    required
                  >
                    <option value="" disabled>Select a category</option>
                    {categories.map((cat: string) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div className="mb-2">
                  <label className="block text-sm font-medium mb-1">Tags</label>
                  <input
                    type="text"
                    value={editForm.tags}
                    onChange={e => {
                      setEditForm({ ...editForm, tags: e.target.value });
                      if (e.target.value.length >= 2) {
                        const filtered = featureAllTags.filter(tag => tag.toLowerCase().includes(e.target.value.toLowerCase()) && !editTags.includes(tag));
                        setEditTagSuggestions(filtered);
                        setShowEditTagSuggestions(true);
                      } else {
                        setShowEditTagSuggestions(false);
                      }
                    }}
                    onKeyDown={e => {
                      if ((e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === ' ') && editForm.tags.trim()) {
                        e.preventDefault();
                        if (!editTags.includes(editForm.tags.trim())) {
                          setEditTags([...editTags, editForm.tags.trim()]);
                        }
                        setEditForm({ ...editForm, tags: '' });
                        setShowEditTagSuggestions(false);
                      }
                    }}
                    className="w-full border rounded px-3 py-2"
                    placeholder="Enter tags separated by space, comma, or semicolon"
                    autoComplete="off"
                  />
                  {showEditTagSuggestions && editTagSuggestions.length > 0 && (
                    <div className="absolute bg-white border rounded shadow mt-1 z-50 w-full">
                      {editTagSuggestions.map((tag: string, idx: number) => (
                        <div
                          key={idx}
                          className="px-3 py-2 cursor-pointer hover:bg-blue-100"
                          onClick={() => {
                            setEditTags([...editTags, tag]);
                            setEditForm({ ...editForm, tags: '' });
                            setShowEditTagSuggestions(false);
                          }}
                        >
                          {tag}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2">
                    {editTags.map((tag, idx) => (
                      <span key={idx} className="bg-gray-200 text-gray-800 px-2 py-1 rounded text-xs flex items-center">
                        {tag}
                        <button type="button" className="ml-1 text-xs text-gray-500 hover:text-red-500" onClick={() => setEditTags(editTags.filter(t => t !== tag))}>&times;</button>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mb-2">
                  <label className="block text-sm font-medium mb-1">Status</label>
                  <select
                    className="w-full border rounded px-3 py-2"
                    value={editForm.status}
                    onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                    required
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>
                <div className="mb-2">
                  <label className="block text-sm font-medium mb-1">Priority</label>
                  <select
                    className="w-full border rounded px-3 py-2"
                    value={editForm.priority}
                    onChange={e => setEditForm({ ...editForm, priority: e.target.value })}
                    required
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 shadow"
                    onClick={async () => {
                      if (!editForm.category) {
                        alert('Feature category is required.');
                        return;
                      }
                      const statusToSend = editForm.status || 'todo';
                      await API.put(`/features/${item.id}`, {
                        title: editForm.title,
                        description: editForm.description,
                        category: editForm.category,
                        tags_input: editTags.join(','),
                        status: statusToSend,
                        priority: editForm.priority,
                        project_id: Number(projectId),
                        parent_feature_id: item.parent_feature_id ?? null,
                      });
                      // Refresh features
                      const allFeaturesRes = await API.get(`/features/project/${projectId}`);
                      setFeatures(allFeaturesRes.data as Feature[]);
                      setEditingFeatureId(null);
                    }}
                  >
                    Save
                  </button>
                  <button
                    className="px-4 py-2 rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-100"
                    onClick={() => setEditingFeatureId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div
              key={item.id}
              className="bg-white rounded-lg shadow p-6 border border-gray-200 hover:bg-blue-50 transition"
            >
              <div className="flex items-center justify-between">
                {editingField?.featureId === item.id && editingField.field === 'title' ? (
                  <input
                    type="text"
                    className="text-xl font-semibold text-blue-700 border rounded px-2 py-1 w-full"
                    value={item.title}
                    onChange={(e) => {
                      const newFeatures = features.map(f => 
                        f.id === item.id ? { ...f, title: e.target.value } : f
                      );
                      setFeatures(newFeatures);
                    }}
                    onBlur={() => handleFieldEdit(item.id, 'title', item.title)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleFieldEdit(item.id, 'title', item.title);
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <span 
                    className="text-xl font-semibold text-blue-700 hover:bg-blue-100 px-2 py-1 rounded cursor-text"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingField({ featureId: item.id, field: 'title' });
                    }}
                  >
                    {item.title}
                  </span>
                )}
              </div>
              <div className="mt-2 text-gray-700 text-base">
                {editingField?.featureId === item.id && editingField.field === 'description' ? (
                  <textarea
                    className="w-full border rounded px-2 py-1"
                    value={item.description}
                    onChange={(e) => {
                      const newFeatures = features.map(f => 
                        f.id === item.id ? { ...f, description: e.target.value } : f
                      );
                      setFeatures(newFeatures);
                    }}
                    onBlur={() => handleFieldEdit(item.id, 'description', item.description)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <div 
                    className="hover:bg-blue-100 px-2 py-1 rounded cursor-text"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingField({ featureId: item.id, field: 'description' });
                    }}
                  >
                    {item.description || 'No description provided.'}
                  </div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {editingField?.featureId === item.id && editingField.field === 'tags' ? (
                  <input
                    type="text"
                    className="w-full border rounded px-2 py-1"
                    value={(item.tags ?? []).map(t => t.tag_name).join(', ')}
                    onChange={(e) => handleTagsEdit(item.id, e.target.value)}
                    onBlur={() => setEditingField(null)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Enter tags separated by commas"
                    autoFocus
                  />
                ) : (
                  <div 
                    className="flex flex-wrap gap-2 hover:bg-blue-100 px-2 py-1 rounded cursor-text w-full"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingField({ featureId: item.id, field: 'tags' });
                    }}
                  >
                    {(item.tags ?? []).length > 0 ? (item.tags ?? []).map((tag) => (
                      <span key={tag.tag_name + '-' + tag.feature_id} className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">
                        {tag.tag_name}
                      </span>
                    )) : (
                      <span className="text-gray-500 text-sm">No tags</span>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-4 flex space-x-4 text-sm">
                <span className="font-medium">Status:</span>
                {editingField?.featureId === item.id && editingField.field === 'status' ? (
                  <select
                    className="capitalize text-gray-600 border rounded px-1"
                    value={item.status}
                    onChange={(e) => handleFieldEdit(item.id, 'status', e.target.value)}
                    onBlur={() => setEditingField(null)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                ) : (
                  <span 
                    className="capitalize text-gray-600 hover:bg-blue-100 px-2 py-1 rounded cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingField({ featureId: item.id, field: 'status' });
                    }}
                  >
                    {item.status}
                  </span>
                )}
                <span className="font-medium ml-4">Priority:</span>
                {editingField?.featureId === item.id && editingField.field === 'priority' ? (
                  <select
                    className="capitalize text-gray-600 border rounded px-1"
                    value={item.priority}
                    onChange={(e) => handleFieldEdit(item.id, 'priority', e.target.value)}
                    onBlur={() => setEditingField(null)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                ) : (
                  <span 
                    className="capitalize text-gray-600 hover:bg-blue-100 px-2 py-1 rounded cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingField({ featureId: item.id, field: 'priority' });
                    }}
                  >
                    {item.priority || '-'}
                  </span>
                )}
              </div>
              <div 
                className="absolute inset-0 cursor-pointer"
                onClick={() => {
                  console.log("Feature card clicked:", {
                    projectId,
                    featureId: item.id,
                    editingField,
                    item
                  });
                  if (projectId && item.id && !editingField) {
                    console.log("Navigating to:", `/projects/${projectId}/features/${item.id}`);
                    router.push(`/projects/${projectId}/features/${item.id}`);
                  }
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
} 
