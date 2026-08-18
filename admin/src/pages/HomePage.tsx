// 首頁：IG 個人頁式版面——頁首（帳號＋今日統計＋系統控制）、限動圓圈列、貼文九宮格。
// 取代原本的儀表板與貼文兩頁。
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { apiGet, apiPost, type ApiError } from '../api/client';

interface StatCounts {
  matched: number;
  publicReplySuccess: number;
  dmSuccess: number;
  failures: number;
}
interface SeriesPoint {
  label: string;
  matched: number;
  dmSuccess: number;
  failures: number;
}
interface TrendSeries {
  daily: SeriesPoint[];
  weekly: SeriesPoint[];
  monthly: SeriesPoint[];
}
interface Status {
  emergencyStop: boolean;
  circuitBreakerStatus: string;
  account: { username: string | null; profilePictureUrl: string | null } | null;
  today: StatCounts;
  total: StatCounts;
  series: TrendSeries;
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

// DM 成效趨勢折線圖（Tremor 風格）：面積漸層＋細橫向格線＋hover tooltip，日/週/月切換。
type TrendPeriod = 'daily' | 'weekly' | 'monthly';

const PERIOD_META: Record<TrendPeriod, { label: string; range: string; tickEvery: number }> = {
  daily: { label: '日', range: '近 30 天', tickEvery: 7 },
  weekly: { label: '週', range: '近 12 週', tickEvery: 2 },
  monthly: { label: '月', range: '近 12 個月', tickEvery: 2 },
};

// Y 軸最大值取「好看的整數」且中線刻度也是整數：2/4/5/10 × 10^k。
function niceCeil(v: number): number {
  if (v <= 2) return 2;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [2, 4, 5, 10]) {
    if (m * pow >= v) return m * pow;
  }
  return 10 * pow;
}

function tickLabel(period: TrendPeriod, label: string): string {
  if (period === 'monthly') {
    const [, m] = label.split('-');
    return `${Number(m)}月`;
  }
  const [, m, d] = label.split('-');
  return `${Number(m)}/${Number(d)}`;
}

function tooltipTitle(period: TrendPeriod, label: string): string {
  const [y, m, d] = label.split('-');
  if (period === 'monthly') return `${y} 年 ${Number(m)} 月`;
  if (period === 'weekly') return `${Number(m)}/${Number(d)} 起的一週`;
  return `${y}/${Number(m)}/${Number(d)}`;
}

function DmTrendChart({ series }: { series: TrendSeries }) {
  const [period, setPeriod] = useState<TrendPeriod>('daily');
  const [hover, setHover] = useState<number | null>(null);
  const data = series[period];
  const n = data.length;

  // 固定 viewBox 座標系，寬度以百分比縮放；tooltip 用同一座標系換算成百分比定位。
  const W = 640;
  const H = 200;
  const PAD_L = 40;
  const PAD_R = 12;
  const PAD_T = 10;
  const PAD_B = 26;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const maxVal = Math.max(0, ...data.map((p) => p.dmSuccess));
  const yMax = niceCeil(maxVal);
  const xAt = (i: number) => PAD_L + (n === 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const yAt = (v: number) => PAD_T + innerH * (1 - v / yMax);

  const linePath = data
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p.dmSuccess).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L${xAt(n - 1).toFixed(1)},${PAD_T + innerH} L${xAt(0).toFixed(1)},${
    PAD_T + innerH
  } Z`;

  const totalDm = data.reduce((s, p) => s + p.dmSuccess, 0);
  const ticks = [0, yMax / 2, yMax];
  const { tickEvery } = PERIOD_META[period];

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const step = n === 1 ? innerW : innerW / (n - 1);
    const idx = Math.min(n - 1, Math.max(0, Math.round((vx - PAD_L) / step)));
    setHover(idx);
  }

  const hovered = hover != null ? data[hover] : null;

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <div className="chart-label">DM 次數</div>
          <div className="chart-kpi">
            {totalDm.toLocaleString()}
            <span className="chart-range">{PERIOD_META[period].range}</span>
          </div>
        </div>
        <div className="seg" role="tablist" aria-label="趨勢圖時間粒度">
          {(Object.keys(PERIOD_META) as TrendPeriod[]).map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={period === p}
              className={period === p ? 'is-active' : ''}
              onClick={() => {
                setPeriod(p);
                setHover(null);
              }}
            >
              {PERIOD_META[p].label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-plot" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="DM 次數趨勢圖">
          <defs>
            <linearGradient id="dm-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary-500)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--primary-500)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* 橫向格線＋Y 軸刻度（無軸線，Tremor 式） */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={yAt(t)}
                y2={yAt(t)}
                className="chart-grid"
              />
              <text x={PAD_L - 8} y={yAt(t) + 3.5} textAnchor="end" className="chart-tick">
                {t.toLocaleString()}
              </text>
            </g>
          ))}

          {/* X 軸刻度（稀疏，從最後一點往回取） */}
          {data.map((p, i) =>
            (n - 1 - i) % tickEvery === 0 ? (
              <text key={p.label} x={xAt(i)} y={H - 8} textAnchor="middle" className="chart-tick">
                {tickLabel(period, p.label)}
              </text>
            ) : null,
          )}

          <path d={areaPath} fill="url(#dm-area)" />
          <path d={linePath} className="chart-line" />

          {/* hover：垂直導引線＋資料點 */}
          {hovered && hover != null ? (
            <g>
              <line
                x1={xAt(hover)}
                x2={xAt(hover)}
                y1={PAD_T}
                y2={PAD_T + innerH}
                className="chart-guide"
              />
              <circle cx={xAt(hover)} cy={yAt(hovered.dmSuccess)} r={4.5} className="chart-dot" />
            </g>
          ) : null}
        </svg>

        {hovered && hover != null ? (
          <div
            className="chart-tooltip"
            style={{
              left: `${(xAt(hover) / W) * 100}%`,
              top: `${(yAt(hovered.dmSuccess) / H) * 100}%`,
            }}
          >
            <div className="chart-tooltip-title">{tooltipTitle(period, hovered.label)}</div>
            <div className="chart-tooltip-row">
              <i className="legend-dot is-dm-line" />DM <strong>{hovered.dmSuccess.toLocaleString()}</strong> 次
            </div>
            <div className="chart-tooltip-row is-muted">符合 {hovered.matched.toLocaleString()}</div>
          </div>
        ) : null}

        {totalDm === 0 ? <div className="chart-empty">{PERIOD_META[period].range}尚無 DM 紀錄</div> : null}
      </div>
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
      <span className="story-label">{active ? '啟用中' : '設定'}</span>
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
  const [togglingId, setTogglingId] = useState<string | null>(null);

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

  // 貼文右上角的自動化開關：active ↔ paused。草稿啟用失敗（設定不完整）時提示點進去補。
  async function toggleAutomation(m: Media) {
    if (!m.automationId) {
      openEditor(m);
      return;
    }
    // 關閉是破壞性操作（正在跑的自動回覆會停），先確認避免誤按。
    if (
      m.automationStatus === 'active' &&
      !window.confirm('確定要暫停這則貼文的自動回覆嗎？暫停後留言將不再自動回覆與私訊。')
    ) {
      return;
    }
    setTogglingId(m.id);
    setError(null);
    try {
      if (m.automationStatus === 'active') {
        await apiPost(`/api/admin/automations/${m.automationId}/pause`, {});
      } else {
        await apiPost(`/api/admin/automations/${m.automationId}/activate`, {});
      }
      await load();
    } catch (e) {
      const err = e as ApiError;
      setError(
        err.status === 422
          ? '無法啟用：這則自動化的設定不完整（點進貼文檢查關鍵字與回覆內容）'
          : err.message,
      );
    } finally {
      setTogglingId(null);
    }
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
      <div className="container page-stack">
        {error || syncNotice || syncErrors.length > 0 ? (
          <div className="stack-sm">
            {error ? <div className="alert alert-danger">{error}</div> : null}
            {syncNotice ? <div className="alert alert-success">{syncNotice}</div> : null}
            {syncErrors.map((e, i) => (
              <div key={i} className="alert alert-danger">
                {e}
              </div>
            ))}
          </div>
        ) : null}

        {status && status.circuitBreakerStatus === 'open' ? (
          <div className="alert alert-danger">
            熔斷器已「自動」開啟：系統偵測到連續 Meta API 失敗，暫停所有發送以保護你的帳號（不是你操作的）。
            確認 Instagram 沒有異常後，按「熔斷復歸」恢復發送。
            <button className="btn btn-sm btn-primary alert-cta" onClick={resetCircuitBreaker}>
              熔斷復歸
            </button>
          </div>
        ) : null}

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
                <span>
                  符合 <strong>{status.total.matched}</strong>
                  <em className="stat-sub">今日 {status.today.matched}</em>
                </span>
                <span>
                  公開回覆 <strong>{status.total.publicReplySuccess}</strong>
                  <em className="stat-sub">今日 {status.today.publicReplySuccess}</em>
                </span>
                <span>
                  DM <strong>{status.total.dmSuccess}</strong>
                  <em className="stat-sub">今日 {status.today.dmSuccess}</em>
                </span>
                <span className={status.total.failures > 0 ? 'is-danger' : ''}>
                  失敗 <strong>{status.total.failures}</strong>
                  <em className="stat-sub">今日 {status.today.failures}</em>
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

        {status?.series ? <DmTrendChart series={status.series} /> : null}

        {/* 既有的待命／全帳號預設（新增入口在頁首導覽的「＋ 新增自動化」） */}
        {pendingAutomations.length > 0 ? (
          <div className="card">
            <div className="section-head">
              <span className="section-heading">未綁定的自動化</span>
              <span className="count">{pendingAutomations.length}</span>
            </div>
            <div className="pending-row">
              {pendingAutomations.map((a) => (
                <button
                  key={a.automationId}
                  type="button"
                  className="chip chip-clickable"
                  onClick={() => navigate(`/automations/new?scope=${a.applyScope}&automationId=${a.automationId}`)}
                >
                  <i
                    className={`status-dot ${
                      a.status === 'active' ? 'is-on' : a.status === 'paused' ? 'is-paused' : 'is-draft'
                    }`}
                    title={a.status === 'active' ? '啟用中' : a.status === 'paused' ? '已暫停' : '草稿'}
                  />
                  {a.applyScope === 'next_post' ? '待綁定' : '全帳號'}｜{a.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* 限動 */}
        <div className="card">
          <div className="section-head">
            <span className="section-heading">限時動態</span>
            <span className="count">{stories.length}</span>
          </div>
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
        </div>

        {/* 貼文九宮格 */}
        <section>
          <div className="section-head">
            <span className="section-heading">貼文</span>
            <span className="count">{posts.length}</span>
          </div>
          {loading ? (
            <div className="state-note">載入中…</div>
          ) : posts.length === 0 ? (
            <div className="card">
              <div className="state-note">尚無貼文。按上方「↻ 同步」從 Instagram 抓取。</div>
            </div>
          ) : (
          <div className="media-grid">
            {posts.map((m) => {
              const stats = statsByMediaId.get(m.id);
              return (
                <div className="media-card" key={m.id}>
                  <div className="media-thumb-wrap" onClick={() => openEditor(m)}>
                    <Thumb url={m.thumbnailUrl} type={m.mediaType} />
                    {m.automationId ? (
                      <button
                        type="button"
                        className={`switch${m.automationStatus === 'active' ? ' is-on' : ''}`}
                        disabled={togglingId === m.id}
                        title={m.automationStatus === 'active' ? '自動回覆啟用中——點擊暫停' : '點擊啟用自動回覆'}
                        aria-label="自動回覆開關"
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleAutomation(m);
                        }}
                      />
                    ) : null}
                  </div>
                  <div className="media-card-body">
                    {stats ? (
                      <div className="media-stats-line">
                        <span>觸發 <strong>{stats.triggered.toLocaleString()}</strong></span>
                        <span>DM <strong>{stats.dmSuccess.toLocaleString()}</strong></span>
                        {stats.failures > 0 ? (
                          <span className="is-danger">失敗 <strong>{stats.failures.toLocaleString()}</strong></span>
                        ) : null}
                      </div>
                    ) : null}
                    <div className={`media-caption${m.caption ? '' : ' is-empty'}`}>
                      {m.caption ?? '（無說明文字）'}
                    </div>
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
        </section>
      </div>
    </>
  );
}
