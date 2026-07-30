// 共用頁首：品牌 + 導覽（儀表板/貼文）+ 目前登入者 + 登出。
import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { apiGet, apiPost } from '../api/client';

export function AppHeader() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');

  useEffect(() => {
    apiGet<{ email: string }>('/api/admin/auth/me')
      .then((r) => setEmail(r.email))
      .catch(() => setEmail(''));
  }, []);

  async function logout() {
    try {
      await apiPost('/api/admin/auth/logout', {});
    } catch {
      /* ignore */
    }
    navigate('/login');
  }

  return (
    <header className="app-header">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div className="app-brand">
          <span className="dot" />
          Instagram Comment DM Bot
        </div>
        <nav className="app-nav">
          <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
            儀表板
          </NavLink>
          <NavLink to="/media" className={({ isActive }) => `nav-link${isActive ? ' is-active' : ''}`}>
            貼文
          </NavLink>
        </nav>
      </div>
      <div className="app-header-right">
        <span>{email}</span>
        <button className="btn btn-ghost btn-sm" onClick={logout}>
          登出
        </button>
      </div>
    </header>
  );
}
