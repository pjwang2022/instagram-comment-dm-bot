// 登入頁：清爽專業風，使用 design token（styles/tokens.css）。
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost, type ApiError } from '../api/client';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiPost('/api/admin/auth/login', { email, password });
      navigate('/');
    } catch (err) {
      setError((err as ApiError).message ?? '登入失敗。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-viewport">
      <div className="login-card">
        <div className="login-brand">
          <span className="dot" style={{ width: 10, height: 10 }} />
          IG Comment DM Bot
        </div>
        <h1 className="login-title">登入管理後台</h1>
        <p className="login-hint">請使用管理者帳號登入以管理自動化與查看紀錄。</p>

        <form onSubmit={handleSubmit}>
          <div className="form-field">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-field">
            <label className="label" htmlFor="password">
              密碼
            </label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error ? (
            <div className="alert alert-danger" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
              {error}
            </div>
          ) : null}

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? '登入中…' : '登入'}
          </button>
        </form>
      </div>
    </div>
  );
}
