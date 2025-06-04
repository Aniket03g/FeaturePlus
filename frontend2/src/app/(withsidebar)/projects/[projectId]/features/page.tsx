'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import API from '@/api/api';

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
          onClick={() => setShowFeatureModal(true)}
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
        {filteredFeatures.map(feature => (
          <div
            key={feature.id}
            className="bg-white rounded-lg shadow p-6 border border-gray-200 hover:bg-blue-50 transition cursor-pointer"
            onClick={() => router.push(`/projects/${projectId}/features/${feature.id}`)}
          >
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
                    className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs"
                  >
                    {tag.tag_name}
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
