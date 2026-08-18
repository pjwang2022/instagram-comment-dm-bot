// 共用頁首：品牌（點擊回首頁）＋右側「新增自動化」下拉與使用者頭像選單（email／帳號設定／登出）。
import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { apiGet, apiPost } from '../api/client';

type OpenMenu = 'new' | 'user' | null;

export function AppHeader() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);

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
    setOpenMenu(null);
    navigate(`/automations/new?scope=${scope}`);
  }

  return (
    <header className="app-header">
      <NavLink to="/" className="app-brand">
        <span className="dot" />
        Instagram Comment DM Bot
      </NavLink>
      <div className="app-header-right">
        <div className="nav-menu">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setOpenMenu(openMenu === 'new' ? null : 'new')}
          >
            ＋ 新增自動化
          </button>
          {openMenu === 'new' ? (
            <>
              <div className="nav-menu-backdrop" onClick={() => setOpenMenu(null)} />
              <div className="nav-dropdown is-right">
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
        <div className="nav-menu">
          <button
            className="avatar-btn"
            title="帳號選單"
            aria-label="帳號選單"
            onClick={() => setOpenMenu(openMenu === 'user' ? null : 'user')}
          >
            {email ? email[0].toUpperCase() : '?'}
          </button>
          {openMenu === 'user' ? (
            <>
              <div className="nav-menu-backdrop" onClick={() => setOpenMenu(null)} />
              <div className="nav-dropdown is-right">
                <div className="user-menu-email">{email || '（未登入）'}</div>
                <button
                  type="button"
                  onClick={() => {
                    setOpenMenu(null);
                    navigate('/account');
                  }}
                >
                  <strong>帳號設定</strong>
                  <span>變更密碼</span>
                </button>
                <button type="button" onClick={logout}>
                  <strong>登出</strong>
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
