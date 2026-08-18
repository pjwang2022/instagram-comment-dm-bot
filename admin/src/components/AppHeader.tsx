// 共用頁首：品牌（點擊回首頁）＋「新增自動化」下拉＋目前登入者＋登出。
import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { apiGet, apiPost } from '../api/client';

export function AppHeader() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

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

  function goNew(scope: 'next_post' | 'account_default') {
    setMenuOpen(false);
    navigate(`/automations/new?scope=${scope}`);
  }

  return (
    <header className="app-header">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <NavLink to="/" className="app-brand">
          <span className="dot" />
          Instagram Comment DM Bot
        </NavLink>
        <nav className="app-nav">
          <div className="nav-menu">
            <button className="btn btn-primary btn-sm" onClick={() => setMenuOpen((o) => !o)}>
              ＋ 新增自動化
            </button>
            {menuOpen ? (
              <>
                <div className="nav-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="nav-dropdown">
                  <button type="button" onClick={() => goNew('next_post')}>
                    <strong>待命自動化</strong>
                    <span>下一篇新貼文上線自動接上，第一則留言也不會漏</span>
                  </button>
                  <button type="button" onClick={() => goNew('account_default')}>
                    <strong>全帳號預設</strong>
                    <span>沒有專屬自動化的貼文一律套用這組設定</span>
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </nav>
      </div>
      <div className="app-header-right">
        <NavLink to="/account" className="nav-link" title="帳號設定（變更密碼）">
          {email}
        </NavLink>
        <button className="btn btn-ghost btn-sm" onClick={logout}>
          登出
        </button>
      </div>
    </header>
  );
}
