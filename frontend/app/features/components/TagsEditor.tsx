"use client";
import { useState, useEffect } from 'react';
import { TagsAPI } from '@/app/api/api';
import styles from './TagsEditor.module.css';

interface TagsEditorProps {
  featureId?: number;
  initialTags?: Array<{ tag_name: string }>;
  onSave?: (tags: string[]) => void;
  onCancel?: () => void;
}

export default function TagsEditor({ featureId, initialTags = [], onSave, onCancel }: TagsEditorProps) {
  const [tags, setTags] = useState<string[]>(initialTags.map(tag => tag.tag_name));
  const [newTag, setNewTag] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [editingTag, setEditingTag] = useState<{index: number, value: string} | null>(null);

  useEffect(() => {
    // Fetch all existing tags for suggestions
    const fetchAllTags = async () => {
      try {
        const response = await TagsAPI.getAll();
        const tags = response.data as {tag_name: string}[];
        const uniqueTags = [...new Set(tags.map(tag => tag.tag_name))];
        setAllTags(uniqueTags);
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    };
    
    fetchAllTags();
  }, []);

  const handleTagChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setNewTag(value);
    
    if (value.length >= 2) {
      const filtered = allTags.filter(tag => 
        tag.toLowerCase().includes(value.toLowerCase()) && 
        !tags.includes(tag)
      );
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setShowSuggestions(false);
    }
  };

  const handleTagSelect = (tag: string) => {
    addTag(tag);
    setNewTag('');
    setShowSuggestions(false);
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTag.trim()) {
      addTag(newTag.trim());
      setNewTag('');
    }
  };

  const addTag = (tag: string) => {
    // Don't add duplicate tags
    if (!tags.includes(tag)) {
      setTags([...tags, tag]);
    }
  };

  const removeTag = (index: number) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  const startEditingTag = (index: number) => {
    setEditingTag({ index, value: tags[index] });
  };

  const updateEditingTag = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (editingTag) {
      setEditingTag({ ...editingTag, value: e.target.value });
    }
  };

  const saveEditingTag = () => {
    if (editingTag && editingTag.value.trim()) {
      const updatedTags = [...tags];
      updatedTags[editingTag.index] = editingTag.value.trim();
      setTags(updatedTags);
      setEditingTag(null);
    }
  };

  const cancelEditingTag = () => {
    setEditingTag(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (editingTag) {
        saveEditingTag();
      } else if (newTag.trim()) {
        addTag(newTag.trim());
        setNewTag('');
      }
    } else if (e.key === 'Escape') {
      if (editingTag) {
        cancelEditingTag();
      } else {
        setNewTag('');
        setShowSuggestions(false);
      }
    }
  };

  const handleSave = () => {
    if (onSave) {
      onSave(tags);
    }
  };

  return (
    <div className={styles.tagsEditor}>
      <h3 className={styles.title}>Edit Tags</h3>
      
      <div className={styles.tagsList}>
        {tags.length > 0 ? (
          <div className={styles.existingTags}>
            {tags.map((tag, index) => (
              <div key={`${tag}-${index}`} className={styles.tagItem}>
                {editingTag && editingTag.index === index ? (
                  <div className={styles.tagEditForm}>
                    <input
                      type="text"
                      value={editingTag.value}
                      onChange={updateEditingTag}
                      onKeyDown={handleKeyDown}
                      autoFocus
                      className={styles.tagEditInput}
                    />
                    <div className={styles.tagEditActions}>
                      <button 
                        type="button" 
                        onClick={saveEditingTag}
                        className={styles.saveButton}
                      >
                        Save
                      </button>
                      <button 
                        type="button" 
                        onClick={cancelEditingTag}
                        className={styles.cancelButton}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className={styles.tagName}>{tag}</span>
                    <div className={styles.tagActions}>
                      <button 
                        type="button"
                        onClick={() => startEditingTag(index)}
                        className={styles.editTagButton}
                      >
                        Edit
                      </button>
                      <button 
                        type="button"
                        onClick={() => removeTag(index)}
                        className={styles.deleteTagButton}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>No tags added yet</div>
        )}
      </div>
      
      <form onSubmit={handleAddTag} className={styles.addTagForm}>
        <div className={styles.tagInputContainer}>
          <input
            type="text"
            placeholder="Add a new tag..."
            value={newTag}
            onChange={handleTagChange}
            onKeyDown={handleKeyDown}
            className={styles.tagInput}
          />
          {showSuggestions && (
            <div className={styles.suggestions}>
              {suggestions.map((suggestion, index) => (
                <div 
                  key={`suggestion-${index}`}
                  className={styles.suggestionItem}
                  onClick={() => handleTagSelect(suggestion)}
                >
                  {suggestion}
                </div>
              ))}
            </div>
          )}
        </div>
        <button 
          type="submit" 
          className={styles.addButton}
          disabled={!newTag.trim()}
        >
          Add
        </button>
      </form>
      
      <div className={styles.formActions}>
        <button 
          type="button" 
          className={styles.cancelButton}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button 
          type="button" 
          className={styles.saveButton}
          onClick={handleSave}
        >
          Save Tags
        </button>
      </div>
    </div>
  );
} 