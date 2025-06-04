"use client";

import { useState, useEffect, useContext } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
// import API from '@/app/api/api';
import API from '@/api/api';
import styles from './page.module.css';
import { AuthContext } from '@/context/AuthContext';

export default () => {
  const { authInfo, project, logout } = useContext(AuthContext);
  console.log("From authcontext:", authInfo, project);  
  const router=useRouter();

  useEffect(()=> {
      logout();
  });
  return (
    <div className={styles.container}>
       <button onClick={logout} className="mt-4 px-4 py-2 bg-red-500 text-white rounded">Logout</button>
    </div>
  );
} 
