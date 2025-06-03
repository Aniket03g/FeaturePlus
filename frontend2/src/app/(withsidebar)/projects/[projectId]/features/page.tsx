'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import API, { TagsAPI } from '@/api/api';
import Link from 'next/link';
import { Feature, User } from "@/app/types";

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
  const [showInlineFeatureForm, setShowInlineFeatureForm] = useState(false);

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
          return (
            <div
              key={item.id}
              className="bg-white rounded-lg shadow p-6 border border-gray-200 hover:bg-blue-50 transition cursor-pointer"
              onClick={() => {
                if (projectId && item.id) {
                  router.push(`/projects/${projectId}/features/${item.id}`);
                }
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xl font-semibold text-blue-700">{item.title}</span>
              </div>
              <div className="mt-2 text-gray-700 text-base">
                {item.description || 'No description provided.'}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(item.tags ?? []).length > 0 && (item.tags ?? []).map((tag) => (
                  <span key={tag.tag_name + '-' + tag.feature_id} className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">{tag.tag_name}</span>
                ))}
              </div>
              <div className="mt-2 flex gap-4 text-sm">
                <span className="font-medium">Status:</span>
                <span className="capitalize text-gray-600">{item.status}</span>
                <span className="font-medium ml-4">Priority:</span>
                <span className="capitalize text-gray-600">{item.priority || '-'}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
} 
