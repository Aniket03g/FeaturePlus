'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import API from '@/api/api';
import Link from 'next/link';

interface Feature {
  id: number;
  title: string;
  status: string;
  priority?: string; // Optional, placeholder if not present
  description?: string;
}

export default function FeaturesPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFeatures = async () => {
      try {
        setLoading(true);
        // Only fetch root features (feature groups)
        const response = await API.get(`/features/project/${projectId}?root_only=true`);
        setFeatures(response.data);
      } catch (error) {
        console.error('Error fetching features:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFeatures();
  }, [projectId]);

  if (loading) {
    return <div className="p-6">Loading features...</div>;
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Feature Group</h1>
      {features.length === 0 ? (
        <p>No feature groups found for this project.</p>
      ) : (
        <div className="space-y-6">
          {features.map((feature) => (
            <Link key={feature.id} href={`/projects/${projectId}/features/${feature.id}`} className="block">
              <div className="bg-white rounded-lg shadow p-6 border border-gray-200 hover:bg-blue-50 transition">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-xl font-semibold text-blue-700">{feature.title}</span>
                    <span className="ml-2 text-xs bg-gray-200 text-gray-700 rounded px-2 py-1">2 tasks</span>
                  </div>
                  <span className="text-blue-500 hover:underline text-sm">View</span>
                </div>
                <div className="mt-2 text-gray-700 text-base">
                  {feature.description || 'No description provided.'}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {/* Dummy tags */}
                  <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">ui</span>
                  <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">api</span>
                  <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">feature</span>
                </div>
                <div className="mt-4 flex space-x-4 text-sm">
                  <span className="font-medium">Status:</span>
                  <span className="capitalize text-gray-600">{feature.status}</span>
                  <span className="font-medium ml-4">Priority:</span>
                  <span className="capitalize text-gray-600">{feature.priority || '-'}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
} 