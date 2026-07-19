'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getFirebaseAuth, getFirebaseDb, isFirebaseConfigured } from '@/lib/firebase';
import { onCanvasTokenInvalid } from '@/lib/api-client';

interface AuthContextType {
  user: User | null;
  apiKey: string;
  canvasUrl: string;
  loading: boolean;
  firebaseReady: boolean;
  /** True once Canvas has rejected the stored token, or the user asked to change it. */
  needsReauth: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  saveApiKey: (key: string, url: string) => Promise<void>;
  /** Open the Canvas token prompt (used by the header's "change token" button). */
  requestReauth: () => void;
  /** Dismiss the prompt without saving. */
  dismissReauth: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [canvasUrl, setCanvasUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);

  // Any api-client call that hits CANVAS_TOKEN_INVALID opens the prompt, wherever it fired from.
  useEffect(() => {
    onCanvasTokenInvalid(() => setNeedsReauth(true));
    return () => onCanvasTokenInvalid(null);
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      console.warn('Firebase is not configured. Set NEXT_PUBLIC_FIREBASE_* env vars in .env.local');
      setLoading(false);
      return;
    }

    setFirebaseReady(true);

    try {
      const firebaseAuth = getFirebaseAuth();
      const firebaseDb = getFirebaseDb();
      const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
        setUser(firebaseUser);
        if (firebaseUser) {
          try {
            const userDoc = await getDoc(doc(firebaseDb, 'users', firebaseUser.uid));
            if (userDoc.exists()) {
              const data = userDoc.data();
              setApiKey(data.apiKey || '');
              setCanvasUrl(data.canvasUrl || '');
            }
          } catch (error) {
            console.error('Error loading user data:', error);
          }
        } else {
          setApiKey('');
          setCanvasUrl('');
        }
        setLoading(false);
      });
      return () => unsubscribe();
    } catch (error) {
      console.error('Firebase initialization error:', error);
      setLoading(false);
    }
  }, []);

  const login = useCallback(async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(getFirebaseAuth(), provider);
  }, []);

  const logout = useCallback(async () => {
    await signOut(getFirebaseAuth());
    setApiKey('');
    setCanvasUrl('');
    setNeedsReauth(false);
  }, []);

  const saveApiKey = useCallback(async (key: string, url: string) => {
    if (!user) throw new Error('Not authenticated');
    const normalizedUrl = url.replace(/\/+$/, '');
    await setDoc(doc(getFirebaseDb(), 'users', user.uid), {
      apiKey: key,
      canvasUrl: normalizedUrl,
    }, { merge: true });
    setApiKey(key);
    setCanvasUrl(normalizedUrl);
    setNeedsReauth(false);
  }, [user]);

  const requestReauth = useCallback(() => setNeedsReauth(true), []);
  const dismissReauth = useCallback(() => setNeedsReauth(false), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        apiKey,
        canvasUrl,
        loading,
        firebaseReady,
        needsReauth,
        login,
        logout,
        saveApiKey,
        requestReauth,
        dismissReauth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
