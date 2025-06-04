'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import API, { TagsAPI } from '@/api/api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface FeatureTag {
  tag_name: string;
  feature_id: number;
  created_by_user: number;
}

interface Feature {
  id: number;
  title: string;
  status: string;
  priority?: string; // Optional, placeholder if not present
  description?: string;
  tags?: FeatureTag[];
  parent_feature_id?: number | null;
}

interface User {
  id: number;
  username: string;
}

export default function FeaturesPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  console.log('projectId from useParams:', projectId);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showFeatureModal, setShowFeatureModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupForm, setGroupForm] = useState({ title: '', description: '', tags: '' });
  const [groupFormLoading, setGroupFormLoading] = useState(false);
  const [groupFormError, setGroupFormError] = useState('');
  const [featureForm, setFeatureForm] = useState({
    title: '',
    parent_feature_id: '',
    description: '',
    tags: '',
    status: 'todo',
    priority: 'medium',
    assignee_id: '',
  });
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [featureAllTags, setFeatureAllTags] = useState<string[]>([]);
  const [featureTagSuggestions, setFeatureTagSuggestions] = useState<string[]>([]);
  const [featureShowTagSuggestions, setFeatureShowTagSuggestions] = useState(false);
  const [featureSelectedTags, setFeatureSelectedTags] = useState<string[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<'all' | number>('all');
  const [featureGroups, setFeatureGroups] = useState<Feature[]>([]);
  const [childFeatures, setChildFeatures] = useState<Feature[]>([]);
  const router = useRouter();
  const [isEditingFeature, setIsEditingFeature] = useState(false);
  const [editingFeature, setEditingFeature] = useState<Feature | null>(null);

  useEffect(() => {
    const fetchFeatures = async () => {
      try {
        setLoading(true);
        // Fetch all root features (feature groups)
        const [groupsRes, usersRes, projectRes] = await Promise.all([
          API.get(`/features/project/${projectId}?root_only=true`),
          API.get('/users'),
          API.get(`/projects/${projectId}`),
        ]);
        setFeatureGroups(groupsRes.data);
        setUsers(usersRes.data);
        setProject(projectRes.data);
        // Fetch all features for this project
        const allFeaturesRes = await API.get(`/features/project/${projectId}`);
        setFeatures(allFeaturesRes.data);
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
      const response = await API.get(`/features/project/${projectId}?root_only=true`);
      setFeatures(response.data);
    } catch (err) {
      setGroupFormError('Failed to create feature group.');
    } finally {
      setGroupFormLoading(false);
    }
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

  const openEditFeatureForm = (feature: Feature) => {
    console.log('Opening edit modal for feature:', feature, 'with projectId:', projectId);
    setShowFeatureModal(true);
    setIsEditingFeature(true);
    setEditingFeature(feature);
    setFeatureForm({
      title: feature.title,
      parent_feature_id: feature.parent_feature_id ? String(feature.parent_feature_id) : '',
      description: feature.description ?? '',
      tags: (feature.tags ?? []).map(t => t.tag_name).join(', '),
      status: feature.status,
      priority: feature.priority ?? 'medium',
      assignee_id: '', // Add if needed
    });
  };

  if (loading) {
    return <div className="p-6">Loading features...</div>;
  }

  return (
   <>
    <div className="p-6 bg-gray-50 min-h-screen max-w-4xl mx-l">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold">Project[{projectId}]: {project?.name || ''} </h1>
        <div className="flex gap-2">
          <button
            className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700 transition"
            onClick={() => setShowGroupModal(true)}
          >
            + Add Feature Group
          </button>
          <button
            className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700 transition"
            onClick={() => setShowFeatureModal(true)}
          >
            + CREATE FEATURE
          </button>
        </div>
      </div>
      {/* Filter Chips Row */}
      <div className="flex gap-2 mb-8">
        <button
          className={`px-4 py-1 rounded-full border text-sm font-medium transition ${selectedGroupId === 'all' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-blue-50'}`}
          onClick={() => setSelectedGroupId('all')}
        >
          All
        </button>
        {featureGroups.map(group => (
          <button
            key={group.id}
            className={`px-4 py-1 rounded-full border text-sm font-medium transition ${selectedGroupId === group.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-blue-50'}`}
            onClick={() => setSelectedGroupId(group.id)}
          >
            {group.title}
          </button>
        ))}
      </div>
      {/* Feature List */}
        <div className="space-y-6">
        {/* Filtering logic for chips */}
        {selectedGroupId === 'all' ? (
          // Show all feature groups and all child features
          [...featureGroups, ...features.filter(f => f.parent_feature_id !== null)].map(item => (
            <div
              key={item.id}
              className="bg-white rounded-lg shadow p-6 border border-gray-200 hover:bg-blue-50 transition cursor-pointer"
              onClick={() => {
                console.log('Card clicked, projectId:', projectId, 'featureId:', item.id);
                if (projectId && item.id) {
                  router.push(`/projects/${projectId}/features/${item.id}`);
                } else {
                  console.error('Invalid projectId or feature id:', projectId, item.id);
                }
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xl font-semibold text-blue-700">{item.title}</span>
                <button
                  className="p-2 rounded hover:bg-blue-100 text-gray-500 hover:text-blue-600 transition"
                  title="Edit Feature"
                  onClick={e => {
                    e.stopPropagation();
                    openEditFeatureForm(item);
                  }}
                >
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                </button>
              </div>
              <div className="mt-2 text-gray-700 text-base">
                {item.description || 'No description provided.'}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(item.tags ?? []).length > 0 && (item.tags ?? []).map((tag) => (
                  <span key={tag.tag_name + '-' + tag.feature_id} className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">{tag.tag_name}</span>
                ))}
              </div>
              <div className="mt-4 flex space-x-4 text-sm">
                <span className="font-medium">Status:</span>
                <span className="capitalize text-gray-600">{item.status}</span>
                <span className="font-medium ml-4">Priority:</span>
                <span className="capitalize text-gray-600">{item.priority || '-'}</span>
              </div>
            </div>
          ))
        ) : (
          // Show only the selected feature group and its child features
          [
            ...featureGroups.filter(g => g.id === selectedGroupId),
            ...features.filter(f => f.parent_feature_id === selectedGroupId)
          ].map(item => (
            <div
              key={item.id}
              className="bg-white rounded-lg shadow p-6 border border-gray-200 hover:bg-blue-50 transition cursor-pointer"
              onClick={() => {
                console.log('Card clicked, projectId:', projectId, 'featureId:', item.id);
                if (projectId && item.id) {
                  router.push(`/projects/${projectId}/features/${item.id}`);
                } else {
                  console.error('Invalid projectId or feature id:', projectId, item.id);
                }
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xl font-semibold text-blue-700">{item.title}</span>
                <button
                  className="p-2 rounded hover:bg-blue-100 text-gray-500 hover:text-blue-600 transition"
                  title="Edit Feature"
                  onClick={e => {
                    e.stopPropagation();
                    openEditFeatureForm(item);
                  }}
                >
                  <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                </button>
              </div>
              <div className="mt-2 text-gray-700 text-base">
                {item.description || 'No description provided.'}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(item.tags ?? []).length > 0 && (item.tags ?? []).map((tag) => (
                  <span key={tag.tag_name + '-' + tag.feature_id} className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">{tag.tag_name}</span>
                ))}
              </div>
              <div className="mt-4 flex space-x-4 text-sm">
                <span className="font-medium">Status:</span>
                <span className="capitalize text-gray-600">{item.status}</span>
                <span className="font-medium ml-4">Priority:</span>
                <span className="capitalize text-gray-600">{item.priority || '-'}</span>
              </div>
            </div>
          ))
        )}
      </div>
      {/* Feature Group Modal */}
      {showGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-10 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md relative">
            <button className="absolute top-2 right-2 text-gray-400 hover:text-gray-600" onClick={() => setShowGroupModal(false)}>&times;</button>
            <h2 className="text-xl font-bold mb-4">Create Feature Group</h2>
            <form onSubmit={handleGroupFormSubmit}>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Feature Group Name</label>
                <input
                  type="text"
                  name="title"
                  value={groupForm.title}
                  onChange={handleGroupFormChange}
                  className="w-full border rounded px-3 py-2"
                  required
                  placeholder="Enter feature group name"
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  name="description"
                  value={groupForm.description}
                  onChange={handleGroupFormChange}
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                  placeholder="Describe the feature group..."
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">Tags</label>
                <input
                  type="text"
                  name="tags"
                  value={groupForm.tags}
                  onChange={handleGroupTagInput}
                  onKeyDown={handleGroupTagKeyDown}
                  className="w-full border rounded px-3 py-2"
                  placeholder="Enter tags separated by space, comma, or semicolon"
                  autoComplete="off"
                />
                {showTagSuggestions && tagSuggestions.length > 0 && (
                  <div className="absolute bg-white border rounded shadow mt-1 z-50 w-full">
                    {tagSuggestions.map((tag, idx) => (
                      <div
                        key={idx}
                        className="px-3 py-2 cursor-pointer hover:bg-blue-100"
                        onClick={() => handleGroupTagSelect(tag)}
                      >
                        {tag}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 mt-2">
                  {selectedTags.map((tag, idx) => (
                    <span key={idx} className="bg-gray-200 text-gray-800 px-2 py-1 rounded text-xs flex items-center">
                      {tag}
                      <button type="button" className="ml-1 text-xs text-gray-500 hover:text-red-500" onClick={() => handleRemoveGroupTag(tag)}>&times;</button>
                    </span>
                  ))}
                </div>
                <div className="text-xs text-gray-500 mt-1">Tags help categorize features. Prefix with # is optional.</div>
              </div>
              {groupFormError && <div className="text-red-500 text-sm mb-2">{groupFormError}</div>}
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  className="px-4 py-2 rounded border border-gray-300 text-gray-700 bg-white hover:bg-gray-100"
                  onClick={() => setShowGroupModal(false)}
                  disabled={groupFormLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 shadow"
                  disabled={groupFormLoading}
                >
                  {groupFormLoading ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Feature Modal */}
      {showFeatureModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-10 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-md relative">
            <button className="absolute top-2 right-2 text-gray-400 hover:text-gray-600" onClick={() => setShowFeatureModal(false)}>&times;</button>
            <h2 className="text-xl font-bold mb-4">{isEditingFeature ? "Edit Feature" : "Add Feature"}</h2>
            <form /* onSubmit={handleFeatureFormSubmit} */ className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="title">Title *</label>
                <input
                  id="title"
                  name="title"
                  type="text"
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={featureForm.title}
                  onChange={e => setFeatureForm({ ...featureForm, title: e.target.value })}
                  required
                  placeholder="Enter feature title"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="description">Description</label>
                <textarea
                  id="description"
                  name="description"
                  className="w-full border rounded px-3 py-2 text-sm min-h-[80px]"
                  value={featureForm.description}
                  onChange={e => setFeatureForm({ ...featureForm, description: e.target.value })}
                  placeholder="Describe the feature..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" htmlFor="tags">Tags</label>
                <input
                  id="tags"
                  name="tags"
                  type="text"
                  className="w-full border rounded px-3 py-2 text-sm"
                  value={featureForm.tags}
                  onChange={e => setFeatureForm({ ...featureForm, tags: e.target.value })}
                  placeholder="Enter tags separated by space, comma, or semicolon"
                />
              </div>
              <div className="flex justify-end gap-3 mt-4">
                <button
                  type="button"
                  className="px-4 py-2 rounded border text-gray-700 bg-gray-100 hover:bg-gray-200"
                  onClick={() => setShowFeatureModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700"
                >
                  {isEditingFeature ? "Save" : "Add Feature"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </>
  );
} 
