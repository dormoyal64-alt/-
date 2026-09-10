import { initializeApp, getApps } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { firebaseConfig, isFirebaseConfigured } from './firebaseConfig';

export { isFirebaseConfigured };

export const app = isFirebaseConfigured
  ? getApps()[0] ?? initializeApp(firebaseConfig)
  : undefined;

export const auth = app ? getAuth(app) : undefined;

export const db = app
  ? initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
  : undefined;
