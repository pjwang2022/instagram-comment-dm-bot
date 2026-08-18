// 帳號設定頁：變更登入密碼。
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { apiPost, type ApiError } from '../api/client';

const MIN_PASSWORD_LENGTH = 12;

export function AccountPage() {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`新密碼長度至少需要 ${MIN_PASSWORD_LENGTH} 個字元。`);
      return;
    }
    if (newPassword !== confirm) {
      setError('兩次輸入的新密碼不一致。');
      return;
    }

    setBusy(true);
    try {
      await apiPost('/api/admin/auth/change-password', { currentPassword, newPassword });
      setNotice('密碼已更新 ✓');
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 401) navigate('/login');
      else setError(apiErr.message ?? '更新失敗，請稍後再試。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader />
      <div className="container container-tight">
        <h1 className="page-title">帳號設定</h1>
        <div className="card">
          <h2 className="card-title">變更密碼</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-field">
              <label className="label" htmlFor="current-password">
                目前密碼
              </label>
              <input
                id="current-password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label className="label" htmlFor="new-password">
                新密碼
              </label>
              <input
                id="new-password"
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder={`至少 ${MIN_PASSWORD_LENGTH} 個字元`}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label className="label" htmlFor="confirm-password">
                確認新密碼
              </label>
              <input
                id="confirm-password"
                className="input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>

            {error ? (
              <div className="alert alert-danger alerts-block" role="alert">
                {error}
              </div>
            ) : null}
            {notice ? (
              <div className="alert alert-success alerts-block" role="status">
                {notice}
              </div>
            ) : null}

            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? '更新中…' : '更新密碼'}
            </button>
          </form>
        </div>
        <p className="page-subtitle is-footnote">
          本系統不提供忘記密碼重設，請妥善保管新密碼。
        </p>
      </div>
    </>
  );
}
