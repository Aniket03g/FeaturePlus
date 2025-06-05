"use client";
import React, { useEffect, useState } from "react";
import API from "@/api/api";

interface Feature {
  id: number;
  title: string;
  status: string;
  project_id: number;
}

interface Project {
  id: number;
  name: string;
}

export default function FeaturesPage() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [featuresRes, projectsRes] = await Promise.all([
          API.get("/features"),
          API.get("/projects"),
        ]);
        setFeatures(featuresRes.data);
        setProjects(projectsRes.data);
      } catch (error) {
        console.error("Error fetching features or projects:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const getProjectName = (project_id: number) => {
    const project = projects.find((p) => p.id === project_id);
    return project ? project.name : "-";
  };

  const handleDelete = async (id: number) => {
    try {
      await API.delete(`/features/${id}`);
      setFeatures(features.filter((feature) => feature.id !== id));
    } catch (error) {
      console.error("Error deleting feature:", error);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Features</h1>
      <div className="overflow-x-auto rounded-lg shadow bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Feature</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {features.map((feature) => (
              <tr key={feature.id}>
                <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{feature.title}</td>
                <td className="px-6 py-4 whitespace-nowrap text-gray-700">{getProjectName(feature.project_id)}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${feature.status === 'active' ? 'bg-green-100 text-green-800' : feature.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                    {feature.status.charAt(0).toUpperCase() + feature.status.slice(1)}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button onClick={() => handleDelete(feature.id)} className="text-red-500 hover:text-red-700">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="p-4 text-center text-gray-500">Loading features...</div>}
        {!loading && features.length === 0 && <div className="p-4 text-center text-gray-500">No features found.</div>}
      </div>
    </div>
  );
} 