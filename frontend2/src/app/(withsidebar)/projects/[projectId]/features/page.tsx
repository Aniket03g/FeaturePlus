'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import API from '@/api/api';
import React from 'react';
import { TagsAPI } from '@/api/api';
import { FiTrash2 } from 'react-icons/fi';

interface Feature {
  id: number;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  category?: string;
  parent_feature_id?: number | null;
  tags?: Array<{
    tag_name: string;
    feature_id: number;
  }>;
}

export default function FeaturesPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId as string;
  const [features, setFeatures] = useState<Feature[]>([]);
  const [project, setProject] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFeatureModal, setShowFeatureModal] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [showInlineCreate, setShowInlineCreate] = useState(false);
  const [newFeature, setNewFeature] = useState({
    title: '',
    description: '',
    category: categories[0] || '',
    priority: 'medium',
    status: 'todo',
  });
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [inlineTags, setInlineTags] = useState<string[]>([]);
  const [inlineTagInput, setInlineTagInput] = useState('');
  const inlineCreateRef = useRef<HTMLDivElement>(null);
  const [softDeletedIds, setSoftDeletedIds] = useState<number[]>([]);

  useEffect(() => {
    const fetchFeatures = async () => {
      try {
        setLoading(true);
        const [featuresRes, projectRes] = await Promise.all([
          API.get(`/features/project/${projectId}`),
          API.get(`/projects/${projectId}`),
        ]);
        setFeatures(featuresRes.data as Feature[]);
        setProject(projectRes.data);
        // Extract categories from config
        if (projectRes.data && projectRes.data.config && Array.isArray(projectRes.data.config.feature_category)) {
          setCategories(projectRes.data.config.feature_category);
        }
      } catch (error) {
        console.error('Error fetching features:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchFeatures();
  }, [projectId]);

  useEffect(() => {
    if (showInlineCreate) {
      TagsAPI.getAll().then(res => {
        const tags = res.data.map((t: any) => t.tag_name);
        setAllTags(tags);
      });
    }
  }, [showInlineCreate]);

  const handleInlineTagInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInlineTagInput(e.target.value);
    if (e.target.value.length >= 2) {
      const filtered = allTags.filter(tag => tag.toLowerCase().includes(e.target.value.toLowerCase()) && !inlineTags.includes(tag));
      setTagSuggestions(filtered);
      setShowTagSuggestions(true);
    } else {
      setShowTagSuggestions(false);
    }
  };
  const handleInlineTagSelect = (tag: string) => {
    setInlineTags([...inlineTags, tag]);
    setInlineTagInput('');
    setShowTagSuggestions(false);
  };
  const handleInlineTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === ' ') && inlineTagInput.trim()) {
      e.preventDefault();
      if (!inlineTags.includes(inlineTagInput.trim())) {
        setInlineTags([...inlineTags, inlineTagInput.trim()]);
      }
      setInlineTagInput('');
      setShowTagSuggestions(false);
    }
  };
  const handleRemoveInlineTag = (tag: string) => {
    setInlineTags(inlineTags.filter(t => t !== tag));
  };
  // Click-away discard logic
  useEffect(() => {
    if (!showInlineCreate) return;
    function handleClickOutside(event: MouseEvent) {
      if (inlineCreateRef.current && !inlineCreateRef.current.contains(event.target as Node)) {
        if (!newFeature.title && !newFeature.description && inlineTags.length === 0) {
          setShowInlineCreate(false);
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showInlineCreate, newFeature, inlineTags]);

  const handleSoftDelete = (featureId: number) => {
    if (window.confirm('Are you sure you want to delete this feature?')) {
      setSoftDeletedIds(ids => [...ids, featureId]);
    }
  };

  const filteredFeatures = selectedCategory === 'All'
    ? features
    : features.filter(f => f.category === selectedCategory);

  if (loading) {
    return <div className="p-6">Loading features...</div>;
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen max-w-4xl mx-l">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-3xl font-bold">Project[{projectId}]: {project?.name}</h1>
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700 transition"
          onClick={() => setShowInlineCreate(true)}
        >
          + CREATE FEATURE
        </button>
      </div>

      {/* Category Filter */}
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

      {/* Feature List */}
      <div className="space-y-6">
        {showInlineCreate && (
          <div ref={inlineCreateRef} className="bg-white rounded-lg shadow p-6 border border-blue-200 hover:bg-blue-50 transition ring-1 ring-blue-100" style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
            <div className="flex items-center justify-between mb-2">
              <input
                className="text-xl font-semibold text-blue-700 border-b border-gray-200 focus:outline-none focus:border-blue-500 w-full mr-4 placeholder:text-blue-400"
                placeholder="Feature title"
                value={newFeature.title}
                onChange={e => setNewFeature(f => ({ ...f, title: e.target.value }))}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                  onClick={async () => {
                    if (!newFeature.title.trim()) return;
                    await API.post(`/features`, {
                      project_id: Number(projectId),
                      title: newFeature.title,
                      description: newFeature.description,
                      category: newFeature.category,
                      priority: newFeature.priority,
                      status: newFeature.status,
                      assignee_id: 0,
                      tags_input: inlineTags.join(','),
                    });
                    setShowInlineCreate(false);
                    setNewFeature({ title: '', description: '', category: categories[0] || '', priority: 'medium', status: 'todo' });
                    setInlineTags([]);
                    setInlineTagInput('');
                    // Refresh features
                    setLoading(true);
                    const [featuresRes, projectRes] = await Promise.all([
                      API.get(`/features/project/${projectId}`),
                      API.get(`/projects/${projectId}`),
                    ]);
                    setFeatures(featuresRes.data as Feature[]);
                    setProject(projectRes.data);
                    setLoading(false);
                  }}
                >
                  Save
                </button>
                <button
                  className="px-3 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
                  onClick={() => setShowInlineCreate(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
            <textarea
              className="w-full border rounded px-3 py-2 text-base mt-2 mb-2"
              placeholder="Feature description"
              value={newFeature.description}
              onChange={e => setNewFeature(f => ({ ...f, description: e.target.value }))}
              rows={2}
            />
            <div className="flex gap-4 mt-2 mb-2">
              <select
                className="border rounded px-2 py-1 text-sm"
                value={newFeature.category}
                onChange={e => setNewFeature(f => ({ ...f, category: e.target.value }))}
              >
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <select
                className="border rounded px-2 py-1 text-sm"
                value={newFeature.priority}
                onChange={e => setNewFeature(f => ({ ...f, priority: e.target.value }))}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <select
                className="border rounded px-2 py-1 text-sm"
                value={newFeature.status}
                onChange={e => setNewFeature(f => ({ ...f, status: e.target.value }))}
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </div>
            {/* Tag input/chips UI */}
            <div className="flex flex-wrap gap-2 items-center bg-gray-50 px-2 py-2 rounded border border-gray-100 shadow-sm mt-2" style={{ minHeight: 44 }}>
              {inlineTags.map((tag) => (
                <span key={tag} className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs flex items-center mb-1">
                  {'#' + tag}
                  <button type="button" className="ml-1 text-xs text-gray-500 hover:text-red-500" onClick={() => handleRemoveInlineTag(tag)} tabIndex={-1}>&times;</button>
                </span>
              ))}
              <div className="relative flex items-center mb-1">
                <input
                  type="text"
                  className="border rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-200"
                  value={inlineTagInput}
                  onChange={handleInlineTagInput}
                  onKeyDown={handleInlineTagKeyDown}
                  placeholder="Add tag..."
                  style={{ minWidth: 120, marginRight: 4 }}
                  tabIndex={0}
                />
                {showTagSuggestions && tagSuggestions.length > 0 && (
                  <div className="absolute left-0 top-full mt-1 bg-white border rounded shadow z-50 w-48 max-h-40 overflow-auto">
                    {tagSuggestions.map((tag, idx) => (
                      <div
                        key={idx}
                        className="px-3 py-2 cursor-pointer hover:bg-blue-100"
                        onClick={() => handleInlineTagSelect(tag)}
                      >
                        {tag}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {filteredFeatures.filter(feature => !softDeletedIds.includes(feature.id)).map(feature => (
          <div
            key={feature.id}
            className="group bg-white rounded-lg shadow p-6 border border-gray-200 hover:bg-blue-50 transition cursor-pointer relative"
            onClick={e => {
              if ((e.target as HTMLElement).closest('.feature-delete-icon, .feature-tag-chip')) return;
              router.push(`/projects/${projectId}/features/${feature.id}`);
            }}
            style={{ overflow: 'visible' }}
          >
            {/* Delete icon absolutely positioned at top right, vertically centered */}
            <button
              className="feature-delete-icon opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50 absolute right-4 top-1/2 -translate-y-1/2"
              title="Delete feature"
              onClick={e => {
                e.stopPropagation();
                handleSoftDelete(feature.id);
              }}
              style={{ color: '#e53e3e', zIndex: 10 }}
            >
              <FiTrash2 size={20} />
            </button>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-blue-700">{feature.title}</h2>
              <span className={`px-3 py-1 rounded-full text-sm ${
                feature.status === 'done' ? 'bg-green-100 text-green-800' :
                feature.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                'bg-gray-100 text-gray-800'
              }`}>
                {feature.status === 'in_progress' ? 'In Progress' : 
                 feature.status === 'done' ? 'Done' : 'To Do'}
              </span>
            </div>
            <p className="mt-2 text-gray-700">{feature.description || 'No description provided.'}</p>
            <div className="mt-4 flex items-center gap-4">
              <span className={`px-2 py-1 rounded text-sm ${
                feature.priority === 'high' ? 'bg-red-100 text-red-800' :
                feature.priority === 'medium' ? 'bg-orange-100 text-orange-800' :
                'bg-blue-100 text-blue-800'
              }`}>
                {feature.priority} priority
              </span>
              {feature.category && (
                <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded text-sm">
                  {feature.category}
                </span>
              )}
            </div>
            {feature.tags && feature.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {feature.tags.map((tag) => (
                  <span
                    key={`${tag.tag_name}-${tag.feature_id}`}
                    className="feature-tag-chip bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs cursor-default"
                    onClick={e => e.stopPropagation()}
                  >
                    {'#' + tag.tag_name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
} 
