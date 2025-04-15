"use client";
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import styles from './Sidebar.module.css';

interface SidebarProps {
  projectId?: string;
  projectName?: string;
}

const Sidebar = ({ projectId, projectName }: SidebarProps) => {
  const pathname = usePathname();
  const isProjectPage = pathname.includes('/projects/') && projectId;

  return (
    <div className={styles.sidebar}>
      {isProjectPage ? (
        <>
          <div className={styles.projectHeader}>
            <h2 className={styles.projectName}>{projectName || 'Project'}</h2>
          </div>
          <ul className={styles.menu}>
            <li className={pathname === `/projects/${projectId}` ? styles.active : ''}>
              <Link href={`/projects/${projectId}`}>Overview</Link>
            </li>
            <li className={pathname === `/projects/${projectId}/board` ? styles.active : ''}>
              <Link href={`/projects/${projectId}/board`}>Board</Link>
            </li>
            <li className={pathname === `/projects/${projectId}/list` ? styles.active : ''}>
              <Link href={`/projects/${projectId}/list`}>List</Link>
            </li>
            <li className={pathname === `/projects/${projectId}/settings` ? styles.active : ''}>
              <Link href={`/projects/${projectId}/settings`}>Settings</Link>
            </li>
          </ul>
        </>
      ) : (
        <div className={styles.defaultSidebar}>
          <h3 className={styles.sidebarHeading}>Quick Links</h3>
          <ul className={styles.menu}>
            <li className={pathname === '/' ? styles.active : ''}>
              <Link href="/">Dashboard</Link>
            </li>
            <li className={pathname === '/projects' ? styles.active : ''}>
              <Link href="/projects">Projects</Link>
            </li>
            <li className={pathname === '/create-project' ? styles.active : ''}>
              <Link href="/create-project">Create Project</Link>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default Sidebar; 