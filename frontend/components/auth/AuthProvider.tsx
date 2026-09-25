"use client";

import React, { createContext, useContext, useEffect, useState, useTransition } from "react";
import { User, onAuthStateChanged, signOut as firebaseSignOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { BackendUserProfile, getBackendCurrentUser } from "@/lib/api";

export interface AuthContextValue {
  user: User | null;
  backendUser: BackendUserProfile | null;
  loading: boolean;
  backendError: string | null;
  signOutUser: () => Promise<void>;
  refreshBackendUser: () => Promise<BackendUserProfile | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [backendUser, setBackendUser] = useState<BackendUserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const syncBackend = async (currentUser: User | null): Promise<BackendUserProfile | null> => {
    if (!currentUser) {
      setBackendUser(null);
      setBackendError(null);
      return null;
    }

    try {
      const profile = await getBackendCurrentUser();
      setBackendUser(profile);
      setBackendError(null);
      return profile;
    } catch (err: unknown) {
      const errorMessage =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Backend user sync failed";
      console.warn("Notice: Backend user sync returned:", errorMessage);
      setBackendError(
        "Backend sync unavailable. Operating in client authentication mode."
      );
      return null;
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      startTransition(async () => {
        setUser(firebaseUser);
        if (firebaseUser) {
          await syncBackend(firebaseUser);
        } else {
          setBackendUser(null);
          setBackendError(null);
        }
        setLoading(false);
      });
    });

    return () => unsubscribe();
  }, []);

  const signOutUser = async () => {
    try {
      await firebaseSignOut(auth);
      setUser(null);
      setBackendUser(null);
      setBackendError(null);
    } catch (error) {
      console.error("Sign out error:", error);
      throw error;
    }
  };

  const refreshBackendUser = async (): Promise<BackendUserProfile | null> => {
    return syncBackend(auth.currentUser || user);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        backendUser,
        loading,
        backendError,
        signOutUser,
        refreshBackendUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
