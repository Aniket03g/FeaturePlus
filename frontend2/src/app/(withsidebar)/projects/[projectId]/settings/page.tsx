"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import API from "@/api/api";
import type { Project } from "@/app/types/project";

const ProjectSettingsPage = () => {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [taskTypes, setTaskTypes] = useState<string[]>([]);
  const [featureCategories, setFeatureCategories] = useState<string[]>([]);
  const [newTaskType, setNewTaskType] = useState("");
  const [newFeatureCategory, setNewFeatureCategory] = useState("");

  const addTaskTypeInputRef = useRef<HTMLInputElement>(null);
  const addFeatureCategoryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const fetchProject = async () => {
      try {
        setLoading(true);
        const res = await API.get(`/projects/${projectId}`);
        setProject(res.data);
        setName(res.data.name || "");
        setDescription(res.data.description || "");
        setTaskTypes(res.data.config?.task_types || []);
        setFeatureCategories(res.data.config?.feature_category || []);
      } catch (e) {
        setError("Failed to fetch project");
      } finally {
        setLoading(false);
      }
    };
    fetchProject();
  }, [projectId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await API.put(`/projects/${projectId}`, {
        name,
        description,
        config: {
          task_types: taskTypes,
          feature_category: featureCategories,
        },
      });
      router.push(`/projects`);
    } catch (e) {
      setError("Failed to save project");
    } finally {
      setSaving(false);
    }
  };

  const removeTaskType = (idx: number) => setTaskTypes(taskTypes.filter((_, i) => i !== idx));
  const addTaskType = () => {
    if (newTaskType.trim() && !taskTypes.includes(newTaskType.trim())) {
      setTaskTypes([...taskTypes, newTaskType.trim()]);
      setNewTaskType("");
      setTimeout(() => addTaskTypeInputRef.current?.focus(), 0);
    }
  };
  const removeFeatureCategory = (idx: number) => setFeatureCategories(featureCategories.filter((_, i) => i !== idx));
  const addFeatureCategory = () => {
    if (newFeatureCategory.trim() && !featureCategories.includes(newFeatureCategory.trim())) {
      setFeatureCategories([...featureCategories, newFeatureCategory.trim()]);
      setNewFeatureCategory("");
      setTimeout(() => addFeatureCategoryInputRef.current?.focus(), 0);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;
  if (!project) return <div>Project not found</div>;

  return (
    <div style={{ maxWidth: 500, margin: '2rem auto', background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px #eee', padding: 24 }}>
      <h2 style={{ marginBottom: 24 }}>Project Settings</h2>
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label>
          Name
          <input value={name} onChange={e => setName(e.target.value)} required style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ddd' }} />
        </label>
        <label>
          Description
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 4, border: '1px solid #ddd' }} />
        </label>
        <label>
          Task Types
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '8px 0' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, minHeight: 36 }}>
              {taskTypes.map((type, idx) => (
                <div key={type} style={{ display: 'flex', alignItems: 'center', background: '#f3f4f6', borderRadius: 999, padding: '6px 16px', boxShadow: '0 1px 3px #eee', fontWeight: 500, fontSize: 15, position: 'relative', transition: 'all 0.2s' }}>
                  <span>{type}</span>
                  <button
                    type="button"
                    onClick={() => removeTaskType(idx)}
                    style={{
                      color: '#dc2626',
                      background: 'none',
                      border: 'none',
                      fontSize: 18,
                      marginLeft: 8,
                      cursor: 'pointer',
                      opacity: 0.7,
                      transition: 'opacity 0.15s',
                    }}
                    onMouseOver={e => (e.currentTarget.style.opacity = '1')}
                    onMouseOut={e => (e.currentTarget.style.opacity = '0.7')}
                    aria-label={`Remove ${type}`}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                ref={addTaskTypeInputRef}
                value={newTaskType}
                onChange={e => setNewTaskType(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTaskType(); } }}
                placeholder="Add new task type"
                style={{ flex: 1, padding: 8, borderRadius: 999, border: '1px solid #ddd', background: '#fafbfc' }}
              />
              <button type="button" onClick={addTaskType} style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 999, padding: '0 20px', fontWeight: 500, fontSize: 15, boxShadow: '0 1px 3px #eee' }}>Add</button>
            </div>
          </div>
        </label>
        <label>
          Feature Categories
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '8px 0' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, minHeight: 36 }}>
              {featureCategories.map((cat, idx) => (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', background: '#f3f4f6', borderRadius: 999, padding: '6px 16px', boxShadow: '0 1px 3px #eee', fontWeight: 500, fontSize: 15, position: 'relative', transition: 'all 0.2s' }}>
                  <span>{cat}</span>
                  <button
                    type="button"
                    onClick={() => removeFeatureCategory(idx)}
                    style={{
                      color: '#dc2626',
                      background: 'none',
                      border: 'none',
                      fontSize: 18,
                      marginLeft: 8,
                      cursor: 'pointer',
                      opacity: 0.7,
                      transition: 'opacity 0.15s',
                    }}
                    onMouseOver={e => (e.currentTarget.style.opacity = '1')}
                    onMouseOut={e => (e.currentTarget.style.opacity = '0.7')}
                    aria-label={`Remove ${cat}`}
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                ref={addFeatureCategoryInputRef}
                value={newFeatureCategory}
                onChange={e => setNewFeatureCategory(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFeatureCategory(); } }}
                placeholder="Add new category"
                style={{ flex: 1, padding: 8, borderRadius: 999, border: '1px solid #ddd', background: '#fafbfc' }}
              />
              <button type="button" onClick={addFeatureCategory} style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 999, padding: '0 20px', fontWeight: 500, fontSize: 15, boxShadow: '0 1px 3px #eee' }}>Add</button>
            </div>
          </div>
        </label>
        <button type="submit" disabled={saving} style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 4, padding: '10px 0', fontWeight: 500, marginTop: 16 }}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </form>
    </div>
  );
};

export default ProjectSettingsPage; 