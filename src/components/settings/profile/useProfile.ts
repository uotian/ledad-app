'use client';
import { useSyncExternalStore } from 'react';
import {
  emptyProfile,
  profileChanged,
  profileSchema,
  profileStorageKey,
  type Profile,
} from './profile';

const empty = JSON.stringify(emptyProfile);
function read() {
  try {
    return localStorage.getItem(profileStorageKey) || empty;
  } catch {
    return empty;
  }
}
function subscribe(notify: () => void) {
  window.addEventListener('storage', notify);
  window.addEventListener(profileChanged, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(profileChanged, notify);
  };
}
export function useProfile() {
  const value = useSyncExternalStore(subscribe, read, () => empty);
  try {
    return profileSchema.parse(JSON.parse(value));
  } catch {
    /* 古い・壊れた設定は空で開く。 */
    return emptyProfile;
  }
}
export function saveProfile(profile: Profile) {
  localStorage.setItem(profileStorageKey, JSON.stringify(profileSchema.parse(profile)));
  window.dispatchEvent(new Event(profileChanged));
}
