"use client";

import { useState, useEffect, useContext } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
// import API from '@/app/api/api';
import API from '@/api/api';
import styles from './page.module.css';
import { AuthContext } from '@/context/AuthContext';

export default () => {
  const { token, authInfo, project, forgetCredentials} = useContext(AuthContext);
  console.log("From authcontext:", authInfo, project);  
  const router=useRouter();

  useEffect(()=> {
    if (authInfo || token) {
      forgetCredentials();
    }
    router.push("/fflogin");
  });

  return (
    <div className={styles.container}>
    <Link href="/fflogin">
      <button>Logout</button>
    </Link>
    </div>
  );
} 
