// 首頁：IG 個人頁式版面——頁首（帳號＋今日統計＋系統控制）、限動圓圈列、貼文九宮格。
// 取代原本的儀表板與貼文兩頁。
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { apiGet, apiPost, type ApiError } from '../api/client';

interface Status {
  emergencyStop: boolean;
  circuitBreakerStatus: string;
  account: { username: string | null; profilePictureUrl: string | null } | null;
  today: { matched: number; publicReplySuccess: number; dmSuccess: number; failures: number };
}
interface Media {
  id: string;
  mediaType: string;
  caption: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  automationStatus: string;
  automationId: string | null;
}
interface AutoStats {
  triggered: number;
  publicReplySuccess: number;
  dmSuccess: number;
  failures: number;
}
interface OverviewAutomation {
  automationId: string;
  name: string;
  status: string;
  applyScope: string;
  media: { id: string } | null;
  stats: AutoStats;
}

function typeLabel(t: string): string {
  if (t === 'VIDEO') return '影片';
  if (t === 'REELS') return 'Reels';
  if (t === 'CAROUSEL_ALBUM') return '多圖';
  if (t === 'STORY') return '限動';
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

function StoryCircle({ story, active, onClick }: { story: Media; active: boolean; onClick: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className={`story-circle${active ? ' is-active' : ''}`}
      onClick={onClick}
      title={active ? '自動化啟用中——點擊編輯' : '點擊設定自動化'}
    >
      <span className="story-ring">
        {story.thumbnailUrl && !failed ? (
          <img src={story.thumbnailUrl} alt="" onError={() => setFailed(true)} />
        ) : (
          <span className="story-fallback">限動</span>
        )}
      </span>
      <span className="story-label">{active ? '⚡ 啟用中' : '設定'}</span>
    </button>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [overview, setOverview] = useState<OverviewAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const [s, m, o] = await Promise.all([
        apiGet<Status>('/api/admin/system/status'),
        apiGet<{ media: Media[] }>('/api/admin/media?limit=100'),
        apiGet<{ automations: OverviewAutomation[] }>('/api/admin/automations/overview'),
      ]);
      setStatus(s);
      setMedia(m.media);
      setOverview(o.automations);
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
    setSyncNotice(null);
    setSyncErrors([]);
    try {
      const summary = await apiPost<{
        accounts: number;
        inserted: number;
        updated: number;
        deleted: number;
        expiredStories: number;
        errors: string[];
      }>('/api/admin/media/sync', {});
      setSyncNotice(
        `同步完成：新增 ${summary.inserted}｜更新 ${summary.updated}｜已刪除貼文 ${summary.deleted ?? 0}｜過期限動 ${summary.expiredStories ?? 0}`,
      );
      // 同步的部分失敗（例如 token 無效）不會中斷整體流程，但必須讓使用者看到。
      setSyncErrors(summary.errors ?? []);
      await load();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSyncing(false);
    }
  }

  async function toggleEmergency() {
    if (!status) return;
    await apiPost(status.emergencyStop ? '/api/admin/system/resume' : '/api/admin/system/emergency-stop', {});
    void load();
  }

  async function resetCircuitBreaker() {
    await apiPost('/api/admin/system/circuit-breaker/reset', {});
    void load();
  }

  // 限動與貼文分流；成效數據以 media id 對 overview join。
  const stories = media.filter((m) => m.mediaType === 'STORY');
  const posts = media.filter((m) => m.mediaType !== 'STORY');
  const statsByMediaId = new Map(
    overview.filter((a) => a.media).map((a) => [a.media!.id, a.stats]),
  );
  const pendingAutomations = overview.filter((a) => a.applyScope !== 'media');

  function openEditor(m: Media) {
    const params = new URLSearchParams();
    if (m.automationId) params.set('automationId', m.automationId);
    if (m.mediaType === 'STORY') params.set('story', '1');
    const q = params.toString();
    navigate(`/media/${m.id}/automation${q ? `?${q}` : ''}`);
  }

  return (
    <>
      <AppHeader />
      <div className="container">
        {error ? <div className="alert alert-danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</div> : null}
        {syncNotice ? (
          <div className="alert alert-success" style={{ marginBottom: 'var(--space-2)' }}>{syncNotice}</div>
        ) : null}
        {syncErrors.map((e, i) => (
          <div key={i} className="alert alert-danger" style={{ marginBottom: 'var(--space-2)' }}>
            {e}
          </div>
        ))}

        {/* IG 個人頁式頁首 */}
        {status ? (
          <div className="profile-header">
            <div className="profile-avatar">
              {status.account?.profilePictureUrl ? (
                <img src={status.account.profilePictureUrl} alt="" />
              ) : (
                <span className="profile-avatar-fallback">IG</span>
              )}
            </div>
            <div className="profile-main">
              <div className="profile-name-row">
                <span className="profile-username">
                  {status.account?.username ? `@${status.account.username}` : '（尚未同步帳號）'}
                </span>
                <span className={`badge ${status.emergencyStop ? 'badge-danger' : 'badge-success'}`}>
                  {status.emergencyStop ? '緊急停止中' : '運作中'}
                </span>
              </div>
              <div className="profile-stats">
                <span>今日符合 <strong>{status.today.matched}</strong></span>
                <span>公開回覆 <strong>{status.today.publicReplySuccess}</strong></span>
                <span>DM <strong>{status.today.dmSuccess}</strong></span>
                <span className={status.today.failures > 0 ? 'is-danger' : ''}>
                  失敗 <strong>{status.today.failures}</strong>
                </span>
              </div>
            </div>
            <div className="profile-actions">
              <button className="btn btn-ghost btn-sm" onClick={sync} disabled={syncing}>
                {syncing ? '同步中…' : '↻ 同步'}
              </button>
              <button
                className={`btn btn-sm ${status.emergencyStop ? 'btn-primary' : 'btn-danger'}`}
                onClick={toggleEmergency}
              >
                {status.emergencyStop ? '恢復系統' : '緊急停止'}
              </button>
            </div>
          </div>
        ) : null}

        {status && status.circuitBreakerStatus !== 'closed' ? (
          <div className="alert alert-danger" style={{ marginBottom: 'var(--space-4)' }}>
            熔斷器已開啟——已暫停所有發送。
            <button className="btn btn-sm btn-primary" style={{ marginLeft: 'var(--space-3)' }} onClick={resetCircuitBreaker}>
              熔斷復歸
            </button>
          </div>
        ) : null}

        {/* 待命／全帳號預設 */}
        <div className="pending-row">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/automations/new?scope=next_post')}>
            ＋ 待命自動化
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/automations/new?scope=account_default')}>
            ＋ 全帳號預設
          </button>
          {pendingAutomations.map((a) => (
            <button
              key={a.automationId}
              type="button"
              className="chip chip-clickable"
              onClick={() => navigate(`/automations/new?scope=${a.applyScope}&automationId=${a.automationId}`)}
            >
              {a.applyScope === 'next_post' ? '待綁定' : '全帳號'}｜{a.name}
              {a.status === 'active' ? ' ⚡' : a.status === 'paused' ? '（暫停）' : '（草稿）'}
            </button>
          ))}
        </div>

        {/* 限動圓圈列 */}
        <div className="story-row">
          {stories.length === 0 ? (
            <span className="state-note">目前沒有進行中的限時動態（按「↻ 同步」抓取）。</span>
          ) : (
            stories.map((s) => (
              <StoryCircle
                key={s.id}
                story={s}
                active={s.automationStatus === 'active'}
                onClick={() => openEditor(s)}
              />
            ))
          )}
        </div>

        {/* 貼文九宮格 */}
        {loading ? (
          <div className="state-note">載入中…</div>
        ) : posts.length === 0 ? (
          <div className="card" style={{ marginTop: 'var(--space-4)' }}>
            <div className="state-note">尚無貼文。按上方「↻ 同步」從 Instagram 抓取。</div>
          </div>
        ) : (
          <div className="media-grid" style={{ marginTop: 'var(--space-4)' }}>
            {posts.map((m) => {
              const stats = statsByMediaId.get(m.id);
              return (
                <div className="media-card" key={m.id}>
                  <div style={{ position: 'relative', cursor: 'pointer' }} onClick={() => openEditor(m)}>
                    <Thumb url={m.thumbnailUrl} type={m.mediaType} />
                    {m.automationStatus === 'active' ? (
                      <span className="media-flash" title="自動化啟用中">⚡</span>
                    ) : m.automationStatus !== 'none' ? (
                      <span className="media-status-tag">
                        <StatusTag status={m.automationStatus} />
                      </span>
                    ) : null}
                  </div>
                  <div className="media-card-body">
                    <div className={`media-caption${m.caption ? '' : ' is-empty'}`}>
                      {m.caption ?? '（無說明文字）'}
                    </div>
                    {stats ? (
                      <div className="media-stats-line">
                        觸發 {stats.triggered} · DM {stats.dmSuccess}
                        {stats.failures > 0 ? <span className="is-danger"> · 失敗 {stats.failures}</span> : null}
                      </div>
                    ) : null}
                    <div className="media-card-footer">
                      {m.permalink ? (
                        <a className="media-permalink" href={m.permalink} target="_blank" rel="noreferrer">
                          在 IG 開啟 ↗
                        </a>
                      ) : (
                        <span />
                      )}
                      <button
                        className={`btn btn-sm ${m.automationId ? 'btn-ghost' : 'btn-primary'}`}
                        onClick={() => openEditor(m)}
                      >
                        {m.automationId ? '編輯自動化' : '設定自動化'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
