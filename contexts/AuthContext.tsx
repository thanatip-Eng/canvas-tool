'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getFirebaseAuth, getFirebaseDb, isFirebaseConfigured } from '@/lib/firebase';

interface AuthContextType {
  user: User | null;
  apiKey: string;
  canvasUrl: string;
  loading: boolean;
  firebaseReady: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  saveApiKey: (key: string, url: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [canvasUrl, setCanvasUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [firebaseReady, setFirebaseReady] = useState(false);

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
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, apiKey, canvasUrl, loading, firebaseReady, login, logout, saveApiKey }}>
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
