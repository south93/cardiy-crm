'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './auth';

export const BRANCH_KEY = 'cardiy.branch';
const EVENT = 'cardiy:branch';

export function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* trình duyệt chặn lưu trữ: bỏ qua */
  }
}

/** Đổi chi nhánh đang làm việc (thanh trên cùng) và báo cho các màn hình đang mở. */
export function setCurrentBranch(id: string) {
  writeStore(BRANCH_KEY, id);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
}

/** Chi nhánh đang làm việc: nhớ theo trình duyệt, chỉ trong phạm vi được phép. */
export function useCurrentBranch(): string {
  const { me } = useAuth();
  const [id, setId] = useState('');
  useEffect(() => {
    if (!me?.branches.length) return;
    const pick = (v: string | null) => (me.branches.some((b) => b.id === v) ? v! : me.branches[0]!.id);
    setId(pick(readStore(BRANCH_KEY)));
    const on = (e: Event) => setId(pick((e as CustomEvent<string>).detail));
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [me]);
  return id;
}
