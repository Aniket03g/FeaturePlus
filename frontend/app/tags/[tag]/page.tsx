"use client";
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { TagsAPI } from '@/app/api/api';
import { Feature } from '@/app/types';
import styles from './page.module.css';
import TagList from '@/app/features/components/TagList';

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

  const handleBackClick = () => {
    router.back();
  };

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner}></div>
        <p>Loading features...</p>
      </div>
    );
  }

  if (error) {
    return <div className={styles.errorContainer}>{error}</div>;
  }

  return (
    <div className={styles.pageContainer}>
      <div className={styles.header}>
        <button className={styles.backButton} onClick={handleBackClick}>
          ← Back
        </button>
        <h1 className={styles.title}>
          Features tagged with <span className={styles.tagName}>#{tagName}</span>
        </h1>
      </div>

      {features.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>🔍</div>
          <p className={styles.emptyTitle}>No features found</p>
          <p className={styles.emptyMessage}>There are no features with this tag</p>
        </div>
      ) : (
        <div className={styles.featuresGrid}>
          {features.map(feature => (
            <div key={feature.id} className={styles.featureCard}>
              <div className={styles.featureHeader}>
                <h3 className={styles.featureTitle}>
                  <Link href={`/projects/${feature.project_id}/features/${feature.id}`}>
                    {feature.title}
                  </Link>
                </h3>
                <span className={styles.featureId}>FP-{feature.id}</span>
              </div>
              {feature.description && (
                <p className={styles.featureDescription}>
                  {feature.description.length > 100
                    ? `${feature.description.substring(0, 100)}...`
                    : feature.description}
                </p>
              )}
              <div className={styles.featureInfo}>
                <span className={`${styles.statusBadge} ${styles[`status${feature.status.charAt(0).toUpperCase() + feature.status.slice(1)}`]}`}>
                  {feature.status === 'in_progress' ? 'In Progress' : 
                  feature.status.charAt(0).toUpperCase() + feature.status.slice(1)}
                </span>
                <span className={`${styles.priorityBadge} ${styles[`priority${feature.priority.charAt(0).toUpperCase() + feature.priority.slice(1)}`]}`}>
                  {feature.priority.charAt(0).toUpperCase() + feature.priority.slice(1)}
                </span>
              </div>
              {feature.tags && feature.tags.length > 0 && (
                <div className={styles.featureTags}>
                  <TagList tags={feature.tags} navigateOnClick={true} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 