"use client";
import { FeatureTag } from '@/app/types';
import styles from './TagChip.module.css';
import { useRouter } from 'next/navigation';

interface TagChipProps {
  tag: FeatureTag;
  onClick?: (tagName: string) => void;
  navigateOnClick?: boolean;
}

const TagChip = ({ tag, onClick, navigateOnClick = false }: TagChipProps) => {
  const router = useRouter();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent event bubbling to parent elements
    
    if (onClick) {
      onClick(tag.tag_name);
    } else if (navigateOnClick) {
      // Navigate to tag filter page
      router.push(`/tags/${encodeURIComponent(tag.tag_name)}`);
    }
  };

  return (
    <div 
      className={styles.tagChip} 
      onClick={handleClick}
      title={`Tag: ${tag.tag_name}`}
    >
      {tag.tag_name}
    </div>
  );
};

export default TagChip; 