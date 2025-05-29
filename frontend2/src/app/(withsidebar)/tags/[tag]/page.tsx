"use client";

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { TagsAPI } from '@/api/api';
import { Feature } from '@/types';

export default function TagPage() {
  const params = useParams();
  const router = useRouter();
  const tagName = params && params.tag ? decodeURIComponent(params.tag as string) : '';
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchFeaturesByTag = async () => {
      try {
        setLoading(true);
        const response = await TagsAPI.getFeaturesByTag(tagName);
        setFeatures(response.data);
      } catch (err) {
        console.error('Error fetching features by tag:', err);
        setError('Failed to load features. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    if (tagName) {
      fetchFeaturesByTag();
    }
  }, [tagName]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3">Loading features...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <button
          onClick={() => router.back()}
          className="text-blue-600 hover:text-blue-800 flex items-center mb-4"
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back
        </button>
        <h1 className="text-3xl font-bold text-gray-900">
          Features tagged with <span className="text-blue-600">#{tagName}</span>
        </h1>
      </div>

      {features.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <div className="text-4xl mb-4">🔍</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No features found</h2>
          <p className="text-gray-600">There are no features with this tag</p>
        </div>
      ) : (
        <div className="space-y-6">
          {features.map(feature => (
            <Link 
              key={feature.id} 
              href={`/projects/${feature.project_id}/features/${feature.id}`}
              className="block"
            >
              <div className="bg-white rounded-lg shadow p-6 border border-gray-200 hover:bg-blue-50 transition">
                <div className="flex items-center justify-between">
                  <span className="text-xl font-semibold text-blue-700">{feature.title}</span>
                  <span className="text-blue-500 hover:underline text-sm">View</span>
                </div>
                <div className="mt-2 text-gray-700 text-base">
                  {feature.description || 'No description provided.'}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(Array.isArray(feature.tags) && feature.tags.length > 0) ? (
                    feature.tags.map((tag) => (
                      <button
                        key={tag.tag_name + '-' + tag.feature_id}
                        type="button"
                        className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs hover:bg-gray-200 transition-colors focus:outline-none"
                        onClick={e => {
                          e.stopPropagation();
                          e.preventDefault();
                          router.push(`/tags/${encodeURIComponent(tag.tag_name)}`);
                        }}
                      >
                        {tag.tag_name}
                      </button>
                    ))
                  ) : (
                    <span className="text-gray-400 text-xs italic">No tags</span>
                  )}
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