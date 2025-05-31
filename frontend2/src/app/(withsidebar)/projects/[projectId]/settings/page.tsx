"use client";

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import API from '@/api/api';
import type { Project } from '../../../../types/project';

const ProjectSettingsPage = () => {
  const router = useRouter();
  const params = useParams();
  const projectId = params?.projectId;
  const [project, setProject] = useState<Project | null>(null);
  const [form, setForm] = useState({ name: '', description: '', task_types: '', feature_category: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    API.get(`/projects/${projectId}`)
      .then((res) => {
        setProject(res.data);
        setForm({
          name: res.data.name || '',
          description: res.data.description || '',
          task_types: Array.isArray(res.data.config?.task_types) ? res.data.config.task_types.join(', ') : '',
          feature_category: Array.isArray(res.data.config?.feature_category) ? res.data.config.feature_category.join(', ') : '',
        });
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load project');
        setLoading(false);
      });
  }, [projectId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        description: form.description,
        owner_id: project?.owner_id, // keep owner_id unchanged
        config: {
          task_types: form.task_types.split(',').map((s) => s.trim()).filter(Boolean),
          feature_category: form.feature_category.split(',').map((s) => s.trim()).filter(Boolean),
        },
      };
      await API.put(`/projects/${projectId}`, payload);
      router.push('/projects');
    } catch (err) {
      setError('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;

  return (
    <div style={{ maxWidth: 520, margin: '2rem auto', background: '#fff', padding: 32, borderRadius: 16, boxShadow: '0 2px 16px #0001', fontFamily: 'Inter, sans-serif' }}>
      <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24, textAlign: 'center' }}>Edit Project</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div>
          <label style={{ fontWeight: 600, fontSize: 16 }}>Name</label>
          <input name="name" value={form.name} onChange={handleChange} required style={{ width: '100%', padding: 12, marginTop: 6, borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 16, background: '#f9fafb' }} />
        </div>
        <div>
          <label style={{ fontWeight: 600, fontSize: 16 }}>Description</label>
          <textarea name="description" value={form.description} onChange={handleChange} rows={3} style={{ width: '100%', padding: 12, marginTop: 6, borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 16, background: '#f9fafb', resize: 'vertical' }} />
        </div>
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 18 }}>
          <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Config</h3>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontWeight: 500, fontSize: 15 }}>Task Types <span style={{ color: '#9ca3af', fontWeight: 400 }}>(comma separated)</span></label>
            <input name="task_types" value={form.task_types} onChange={handleChange} placeholder="e.g. Bug, Feature, Chore" style={{ width: '100%', padding: 10, marginTop: 6, borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 15, background: '#f9fafb' }} />
          </div>
          <div>
            <label style={{ fontWeight: 500, fontSize: 15 }}>Feature Category <span style={{ color: '#9ca3af', fontWeight: 400 }}>(comma separated)</span></label>
            <input name="feature_category" value={form.feature_category} onChange={handleChange} placeholder="e.g. UI, Backend, API" style={{ width: '100%', padding: 10, marginTop: 6, borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 15, background: '#f9fafb' }} />
          </div>
        </div>
        <button type="submit" disabled={saving} style={{ background: '#4f46e5', color: '#fff', padding: 14, border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 18, marginTop: 10, boxShadow: '0 1px 4px #0001', cursor: 'pointer', transition: 'background 0.2s' }}>
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
};

export default ProjectSettingsPage; 