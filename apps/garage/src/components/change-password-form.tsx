'use client';

import { checkPasswordPolicy } from '@cardiy/shared';
import { Alert, Button, Field, Input, Spinner } from '@cardiy/ui';
import { useState, type FormEvent } from 'react';
import { api, ApiError, type TokenResponse } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const auth = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const policy = next ? checkPasswordPolicy(next) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setOk(false);
    if (policy) return setError(policy);
    if (next !== confirm) return setError('Mật khẩu nhập lại không khớp');
    setBusy(true);
    try {
      const t = await api<TokenResponse>('/auth/change-password', { body: { currentPassword: current, newPassword: next } });
      await auth.applyTokens(t);
      setCurrent('');
      setNext('');
      setConfirm('');
      setOk(true);
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không đổi được mật khẩu');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="change-password-form">
      {error && <Alert>{error}</Alert>}
      {ok && <Alert tone="mint">Đã đổi mật khẩu.</Alert>}
      <Field label="Mật khẩu hiện tại">
        {(id) => <Input id={id} name="current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />}
      </Field>
      <Field label="Mật khẩu mới" hint="Ít nhất 8 ký tự, có cả chữ và số" error={policy}>
        {(id) => <Input id={id} name="new" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />}
      </Field>
      <Field label="Nhập lại mật khẩu mới" error={confirm && confirm !== next ? 'Chưa khớp' : null}>
        {(id) => <Input id={id} name="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
      </Field>
      <Button type="submit" disabled={busy}>
        {busy && <Spinner />}Đổi mật khẩu
      </Button>
    </form>
  );
}
