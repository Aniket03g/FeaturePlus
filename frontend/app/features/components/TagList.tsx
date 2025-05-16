"use client";
import { FeatureTag } from '@/app/types';
import TagChip from './TagChip';
import styles from './TagList.module.css';

interface TagListProps {
  tags?: FeatureTag[];
  onTagClick?: (tagName: string) => void;
  navigateOnClick?: boolean;
}

const TagList = ({ tags, onTagClick, navigateOnClick = false }: TagListProps) => {
  if (!tags || tags.length === 0) {
    return null;
  }

  return (
    <div className={styles.tagList}>
      {tags.map((tag) => (
        <TagChip 
          key={`${tag.feature_id}-${tag.tag_name}`} 
          tag={tag} 
          onClick={onTagClick}
          navigateOnClick={navigateOnClick}
        />
      ))}
    </div>
  );
};

export default TagList; 