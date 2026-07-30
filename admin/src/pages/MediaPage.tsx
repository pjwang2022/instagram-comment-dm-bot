// 貼文管理頁：IG 風格縮圖網格，每篇可建立/編輯自動化。
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { apiGet, apiPost, type ApiError } from '../api/client';

interface Media {
  id: string;
  platform?: string;
  mediaType: string;
  caption: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  automationStatus: string;
  automationId: string | null;
}

interface OverviewAutomation {
  automationId: string;
  name: string;
  status: string;
  applyScope: string;
  platform?: string;
  media: { id: string } | null;
}

function typeLabel(t: string): string {
  if (t === 'POST') return 'FB 貼文';
  if (t === 'VIDEO') return '影片';
  if (t === 'REELS') return 'Reels';
  if (t === 'CAROUSEL_ALBUM') return '多圖';
  return '圖片';
}

// 影片/Reels 用播放三角，多圖用堆疊方塊，圖片不標。
function TypeIcon({ type }: { type: string }) {
  if (type === 'VIDEO' || type === 'REELS') {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M8 5v14l11-7z" />
      </svg>
    );
  }
  if (type === 'CAROUSEL_ALBUM') {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M4 16V6a2 2 0 0 1 2-2h10" />
      </svg>
    );
  }
  return null;
}

function StatusTag({ status }: { status: string }) {
  if (status === 'active') return <span className="badge badge-success">啟用中</span>;
  if (status === 'paused') return <span className="badge badge-warning">已暫停</span>;
  if (status === 'draft') return <span className="badge badge-neutral">草稿</span>;
  return null;
}

function Thumb({ url, type }: { url: string | null; type: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="media-thumb">
      {url && !failed ? (
        <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className="media-thumb-fallback">{typeLabel(type)}</div>
      )}
      {(type === 'VIDEO' || type === 'REELS' || type === 'CAROUSEL_ALBUM') && (
        <span className="media-type-tag">
          <TypeIcon type={type} />
          {typeLabel(type)}
        </span>
      )}
    </div>
  );
}

export function MediaPage() {
  const navigate = useNavigate();
  const [media, setMedia] = useState<Media[]>([]);
  const [pendingAutomations, setPendingAutomations] = useState<OverviewAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, o] = await Promise.all([
        apiGet<{ media: Media[] }>('/api/admin/media?limit=100'),
        apiGet<{ automations: OverviewAutomation[] }>('/api/admin/automations/overview'),
      ]);
      setMedia(m.media);
      // 尚未綁定貼文的自動化（待命/全帳號預設）。
      setPendingAutomations(o.automations.filter((a) => a.applyScope !== 'media'));
    } catch (e) {
      if ((e as ApiError).status === 401) navigate('/login');
      else setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    setError(null);
    try {
      await apiPost('/api/admin/media/sync', {});
      await load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSyncing(false);
    }
  }

  function editAutomation(m: Media) {
    const q = m.automationId ? `?automationId=${m.automationId}` : '';
    navigate(`/media/${m.id}/automation${q}`);
  }

  return (
    <>
      <AppHeader />
      <div className="container">
        <div className="status-line" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 className="page-title">貼文</h1>
            <p className="page-subtitle" style={{ marginBottom: 0 }}>
              從 Instagram／Facebook 粉專同步的貼文，為某篇設定留言關鍵字自動回覆。
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={sync} disabled={syncing}>
            {syncing ? '同步中…' : '↻ 同步貼文'}
          </button>
        </div>

        {error ? <div className="alert alert-danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</div> : null}

        <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="status-line" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>排程／新貼文自動化</strong>
              <p className="page-subtitle" style={{ margin: 0 }}>
                排程中的貼文在上線前不會出現在下方列表（Instagram API 限制）。想事先設定，
                建立「待命自動化」——新貼文一上線就自動接上，第一則留言也不會漏。
              </p>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/automations/new?scope=next_post')}>
                ＋ 待命自動化
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => navigate('/automations/new?scope=account_default')}
              >
                ＋ 全帳號預設
              </button>
            </div>
          </div>
          {pendingAutomations.length > 0 ? (
            <ul style={{ listStyle: 'none', margin: 'var(--space-3) 0 0', padding: 0 }}>
              {pendingAutomations.map((a) => (
                <li
                  key={a.automationId}
                  className="status-line"
                  style={{ justifyContent: 'space-between', padding: 'var(--space-2) 0' }}
                >
                  <span>
                    {a.name}{' '}
                    <span className="badge badge-neutral">
                      {a.platform === 'facebook' ? 'FB · ' : ''}
                      {a.applyScope === 'next_post' ? '待綁定：下一篇新貼文' : '全帳號預設'}
                    </span>{' '}
                    <StatusTag status={a.status} />
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      navigate(`/automations/new?scope=${a.applyScope}&automationId=${a.automationId}`)
                    }
                  >
                    編輯
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {loading ? (
          <div className="state-note">載入中…</div>
        ) : media.length === 0 ? (
          <div className="card">
            <div className="state-note">尚無貼文。點右上「同步貼文」從 Instagram 抓取。</div>
          </div>
        ) : (
          <div className="media-grid" style={{ marginTop: 'var(--space-2)' }}>
            {media.map((m) => (
              <div className="media-card" key={m.id}>
                <div style={{ position: 'relative' }}>
                  <Thumb url={m.thumbnailUrl} type={m.mediaType} />
                  {m.platform === 'facebook' ? (
                    <span className="media-type-tag" style={{ left: 8, right: 'auto' }}>
                      FB
                    </span>
                  ) : null}
                  {m.automationStatus !== 'none' ? (
                    <span className="media-status-tag">
                      <StatusTag status={m.automationStatus} />
                    </span>
                  ) : null}
                </div>
                <div className="media-card-body">
                  <div className={`media-caption${m.caption ? '' : ' is-empty'}`}>
                    {m.caption ?? '（無說明文字）'}
                  </div>
                  <div className="media-card-footer">
                    {m.permalink ? (
                      <a className="media-permalink" href={m.permalink} target="_blank" rel="noreferrer">
                        {m.platform === 'facebook' ? '在 FB 開啟 ↗' : '在 IG 開啟 ↗'}
                      </a>
                    ) : (
                      <span />
                    )}
                    <button
                      className={`btn btn-sm ${m.automationId ? 'btn-ghost' : 'btn-primary'}`}
                      onClick={() => editAutomation(m)}
                    >
                      {m.automationId ? '編輯自動化' : '設定自動化'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
