'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import API from '@/api/api';

interface Project {
  id: number;
  name: string;
  description: string;
  owner_id?: number;
  status?: string;
  created_at: string;
  updated_at: string;
}

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.id as string;
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProject = async () => {
      try {
        setLoading(true);
        const response = await API.get(`/projects/${projectId}`);
        setProject(response.data);
      } catch (error) {
        console.error('Error fetching project:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProject();
  }, [projectId]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">{project?.name}</h1>
      <p className="mb-4 text-gray-700">{project?.description}</p>
      <Link
        href={`/projects/${projectId}/features`}
        className="inline-block bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg mb-6"
      >
        View Features
      </Link>
      {/* ...rest of the project details... */}
    </div>
  );
}