"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import API from "@/app/api/api";
import type { Feature } from "@/app/types";
import styles from "../../list/FeatureList.module.css";

const TagFeatureListPage = () => {
  const params = useParams();
  const tag = params.tag as string;
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFeatures = async () => {
      try {
        setLoading(true);
        const res = await API.get("/features"); // Assumes this returns all features
        setFeatures(res.data.filter((f: Feature) => f.tag === tag));
      } catch (err) {
        setFeatures([]);
      } finally {
        setLoading(false);
      }
    };
    fetchFeatures();
  }, [tag]);

  return (
    <div className={styles.pageWrapper}>
      <div className={styles.container}>
        <h2 style={{ margin: "2rem 0 1rem 0" }}>Features with tag: <span style={{ textTransform: "uppercase" }}>{tag}</span></h2>
        {loading ? (
          <div>Loading...</div>
        ) : features.length === 0 ? (
          <div>No features found with this tag.</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {features.map((feature) => (
              <li key={feature.id} style={{ marginBottom: 24, padding: 16, border: "1px solid #eee", borderRadius: 8 }}>
                <div style={{ fontWeight: 600, fontSize: "1.1rem" }}>{feature.title}</div>
                <div style={{ color: "#6b7280", marginBottom: 4 }}>{feature.description}</div>
                <span className={
                  feature.tag === 'p0' ? styles.tagP0 : feature.tag === 'p1' ? styles.tagP1 : styles.tagP2
                }>
                  {feature.tag?.toUpperCase()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default TagFeatureListPage; 