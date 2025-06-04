"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { TagsAPI } from "@/api/api";

interface Feature {
  id: number;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "done";
  priority: "low" | "medium" | "high";
  category?: string;
  parent_feature_id?: number | null;
  tags?: Array<{
    tag_name: string;
    feature_id: number;
  }>;
}

export default function TagFeatureListPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const tagName = decodeURIComponent(params.tagName as string);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchFeatures() {
      setLoading(true);
      try {
        const res = await TagsAPI.getFeaturesByTag(tagName);
        setFeatures(res.data || []);
      } catch (e) {
        setFeatures([]);
      } finally {
        setLoading(false);
      }
    }
    fetchFeatures();
  }, [tagName]);

  return (
    <div className="p-6 bg-gray-50 min-h-screen max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Features with tag <span className="text-blue-600">#{tagName}</span></h1>
      {loading ? (
        <div>Loading...</div>
      ) : features.length === 0 ? (
        <div className="text-gray-500">No features found with this tag.</div>
      ) : (
        <div className="space-y-6">
          {features.map((feature) => (
            <div
              key={feature.id}
              className="group bg-white rounded-lg shadow p-6 border border-gray-200 hover:bg-blue-50 transition cursor-pointer relative"
              onClick={() => router.push(`/projects/${projectId}/features/${feature.id}`)}
              style={{ overflow: 'visible' }}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-blue-700 flex items-center gap-2">
                  {feature.title}
                </h2>
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
                      className="feature-tag-chip bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs cursor-pointer hover:bg-blue-100 transition"
                      onClick={e => {
                        e.stopPropagation();
                        if (tag.tag_name !== tagName) {
                          router.push(`/projects/${projectId}/tags/${encodeURIComponent(tag.tag_name)}`);
                        }
                      }}
                    >
                      {'#' + tag.tag_name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 