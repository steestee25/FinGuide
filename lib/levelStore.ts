// Proficiency level shared by the analysis page, the chat header and the chat,
// plus the profile's `reviewer` flag (only reviewers may change the level).
import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { loadProficiencyLevel } from './questionnaireStorage';
import { supabase } from './supabase';

type Level = 'base' | 'intermediate' | 'advanced';
const LEVELS: Level[] = ['base', 'intermediate', 'advanced'];

let level: Level = 'intermediate';
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => { listeners.delete(l); });

export function setSharedLevel(next: Level) {
  if (next === level) return;
  level = next;
  listeners.forEach((l) => l());
}

let loaded = false;
export function useSharedLevel(): [Level, (l: Level) => void] {
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    loadProficiencyLevel().then((l) => {
      if (LEVELS.includes(l as Level)) setSharedLevel(l as Level);
    });
  }, []);
  return [useSyncExternalStore(subscribe, () => level, () => level), setSharedLevel];
}

let reviewer = false;
let reviewerUserId: string | null = null;
const reviewerListeners = new Set<() => void>();
const subscribeReviewer = (l: () => void) => (reviewerListeners.add(l), () => { reviewerListeners.delete(l); });

export function useIsReviewer(): boolean {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (userId === reviewerUserId) return;
    reviewerUserId = userId;
    const set = (v: boolean) => { reviewer = v; reviewerListeners.forEach((l) => l()); };
    if (!userId) return set(false);
    supabase.from('profiles').select('reviewer').eq('id', userId).maybeSingle()
      .then(({ data }) => set(data?.reviewer === true));
  }, [userId]);
  return useSyncExternalStore(subscribeReviewer, () => reviewer, () => reviewer);
}
