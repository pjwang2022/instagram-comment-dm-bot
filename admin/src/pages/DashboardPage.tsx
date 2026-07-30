// 儀表板：系統控制 + 今日總覽 + 已設定自動化的貼文（每篇顯示數據）。
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { apiGet, apiPost, type ApiError } from '../api/client';

interface TodayStats {
  matched: number;
  publicReplySuccess: number;
  dmSuccess: number;
  failures: number;
}
interface PlatformStatus {
  platform: string;
  username: string | null;
  circuitBreakerStatus: string;
  tokenExpiresAt: string | null;
  lastWebhookReceivedAt: string | null;
  automationEnabled: boolean;
  today: TodayStats;
}
interface Status {
  emergencyStop: boolean;
  circuitBreakerStatus: string;
  today: TodayStats;
  platforms?: PlatformStatus[];
}
interface AutoStats {
  triggered: number;
  publicReplySuccess: number;
  dmSuccess: number;
  failures: number;
}
interface AutoItem {
  automationId: string;
  name: string;
  status: string;
  applyScope?: string;
  platform?: string;
  keywordCount: number;
  media: { id: string; mediaType: string; caption: string | null; thumbnailUrl: string | null; permalink: string | null } | null;
  stats: AutoStats;
}

function platformLabel(p: string): string {
  return p === 'facebook' ? 'Facebook 粉專' : 'Instagram';
}

// 單一平台的監控卡：帳號、熔斷器、webhook 心跳、今日成效。
function PlatformCard({ p }: { p: PlatformStatus }) {
  const healthy = p.circuitBreakerStatus === 'closed' && p.automationEnabled;
  return (
    <div className="card" style={{ flex: 1, minWidth: 260 }}>
      <div className="status-line" style={{ justifyContent: 'space-between' }}>
        <strong>
          {platformLabel(p.platform)}
          {p.username ? <span className="muted-inline">（{p.username}）</span> : null}
        </strong>
        <span className={`badge ${healthy ? 'badge-success' : 'badge-warning'}`}>
          {healthy ? '正常' : p.automationEnabled ? `熔斷：${p.circuitBreakerStatus}` : '已停用'}
        </span>
      </div>
      <div className="muted-inline" style={{ display: 'block', marginTop: 'var(--space-2)' }}>
        今日 · 符合 {p.today.matched}｜公開回覆 {p.today.publicReplySuccess}｜DM {p.today.dmSuccess}｜失敗{' '}
        {p.today.failures}
      </div>
      <div className="muted-inline" style={{ display: 'block', marginTop: 'var(--space-1)' }}>
        最後 webhook：{p.lastWebhookReceivedAt ? p.lastWebhookReceivedAt.replace('T', ' ').slice(0, 16) : '尚未收到'}
        {p.tokenExpiresAt ? `｜Token 到期：${p.tokenExpiresAt.slice(0, 10)}` : ''}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return <span className="badge badge-success">啟用中</span>;
  if (status === 'paused') return <span className="badge badge-warning">已暫停</span>;
  return <span className="badge badge-neutral">草稿</span>;
}

function Thumb({ url, type }: { url: string | null; type: string }) {
  const [failed, setFailed] = useState(false);
  const label = type === 'VIDEO' ? '影片' : type === 'REELS' ? 'Reels' : type === 'CAROUSEL_ALBUM' ? '多圖' : '圖片';
  return (
    <div className="auto-thumb">
      {url && !failed ? (
        <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className="auto-thumb-fallback">{label}</div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status | null>(null);
  const [autos, setAutos] = useState<AutoItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        apiGet<Status>('/api/admin/system/status'),
        apiGet<{ automations: AutoItem[] }>('/api/admin/automations/overview'),
      ]);
      setStatus(s);
      setAutos(a.automations);
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

  async function toggleEmergency() {
    if (!status) return;
    await apiPost(status.emergencyStop ? '/api/admin/system/resume' : '/api/admin/system/emergency-stop', {});
    void load();
  }

  return (
    <>
      <AppHeader />
      <div className="container">
        <h1 className="page-title">儀表板</h1>
        <p className="page-subtitle">系統狀態與各則自動化的成效。</p>

        {error ? <div className="alert alert-danger">錯誤：{error}</div> : null}

        {status ? (
          <>
            <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="toolbar">
                <span className={`badge ${status.emergencyStop ? 'badge-danger' : 'badge-success'}`}>
                  {status.emergencyStop ? '緊急停止中' : '系統運作中'}
                </span>
                <span className="muted-inline">
                  今日合計 · 符合 {status.today.matched}｜公開回覆 {status.today.publicReplySuccess}｜DM {status.today.dmSuccess}｜失敗 {status.today.failures}
                </span>
                <div style={{ flex: 1 }} />
                <button className={`btn btn-sm ${status.emergencyStop ? 'btn-primary' : 'btn-danger'}`} onClick={toggleEmergency}>
                  {status.emergencyStop ? '恢復系統' : '緊急停止'}
                </button>
              </div>
            </div>

            {status.platforms && status.platforms.length > 0 ? (
              <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-6)' }}>
                {status.platforms.map((p) => (
                  <PlatformCard key={p.platform} p={p} />
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        <h2 className="section-title">
          已設定自動化的貼文<span className="count">{autos.length}</span>
        </h2>

        {loading ? (
          <div className="state-note">載入中…</div>
        ) : autos.length === 0 ? (
          <div className="card">
            <div className="state-note">
              還沒有任何自動化。到「貼文」頁選一篇貼文，設定關鍵字與回覆內容。
            </div>
          </div>
        ) : (
          <div className="auto-list">
            {autos.map((a) => (
              <div className="auto-card" key={a.automationId}>
                <Thumb url={a.media?.thumbnailUrl ?? null} type={a.media?.mediaType ?? 'IMAGE'} />
                <div className="auto-body">
                  <div className="auto-head">
                    <span className="auto-name">{a.name}</span>
                    {a.platform === 'facebook' ? <span className="badge badge-neutral">FB</span> : null}
                    {a.applyScope === 'next_post' ? (
                      <span className="badge badge-neutral">待綁定</span>
                    ) : a.applyScope === 'account_default' ? (
                      <span className="badge badge-neutral">全帳號預設</span>
                    ) : null}
                    <StatusBadge status={a.status} />
                    <span className="muted-inline">{a.keywordCount} 個關鍵字</span>
                    <div className="auto-head-spacer" />
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        a.media
                          ? navigate(`/media/${a.media.id}/automation?automationId=${a.automationId}`)
                          : navigate(`/automations/new?scope=${a.applyScope}&automationId=${a.automationId}`)
                      }
                    >
                      編輯
                    </button>
                  </div>
                  {a.media?.caption ? <div className="auto-caption">{a.media.caption}</div> : null}
                  <div className="auto-stats">
                    <div className="auto-stat">
                      <span className="auto-stat-label">觸發次數</span>
                      <span className="auto-stat-value">{a.stats.triggered}</span>
                    </div>
                    <div className="auto-stat">
                      <span className="auto-stat-label">公開回覆成功</span>
                      <span className="auto-stat-value">{a.stats.publicReplySuccess}</span>
                    </div>
                    <div className="auto-stat">
                      <span className="auto-stat-label">DM 成功</span>
                      <span className="auto-stat-value">{a.stats.dmSuccess}</span>
                    </div>
                    <div className="auto-stat">
                      <span className="auto-stat-label">失敗</span>
                      <span className={`auto-stat-value ${a.stats.failures > 0 ? 'is-danger' : 'is-muted'}`}>
                        {a.stats.failures}
                      </span>
                    </div>
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
