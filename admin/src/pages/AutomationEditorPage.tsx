// 自動化編輯器：為某篇貼文建立/編輯留言關鍵字自動回覆。
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { AppHeader } from '../components/AppHeader';
import { apiGet, apiPost, type ApiError } from '../api/client';

type MatchType = 'contains_any' | 'exact_any' | 'all_comments';

interface AutomationDetail {
  automation: {
    id: string;
    name: string;
    status: string;
    applyScope?: string;
    matchType: MatchType;
    publicReplyEnabled: number;
    privateReplyEnabled: number;
    openingDm: string | null;
    buttonText: string | null;
    buttonUrl: string | null;
    dailyLimit: number | null;
  };
  media: { id: string; mediaType: string } | null;
  keywords: string[];
  publicReplyVariants: string[];
}

// 新建自動化時預填的公開回覆範本（可改可刪）。
const DEFAULT_PUBLIC_REPLIES = [
  '已經私訊你囉，記得去小盒子看看 📩',
  '連結傳到你的 DM 了，去收信吧！',
  '私訊已發送給你 🙌 沒收到的話檢查一下訊息邀請',
];

const ACTIVATION_REASON_TEXT: Record<string, string> = {
  keywords_required: '至少需要一個關鍵字（除非比對模式為「所有留言」）',
  at_least_one_reply_required: '至少要啟用「公開回覆」或「Private Reply」其中一項',
  opening_dm_required: 'Private Reply 啟用時，Opening DM 不能為空',
  private_reply_required_for_story: '限動自動化必須啟用 Private Reply（私訊是唯一動作）',
  button_url_invalid: '按鈕網址必須是有效的 HTTPS 網址',
  token_unhealthy: 'Instagram Token 狀態異常',
  emergency_stop_active: '目前系統處於緊急停止狀態',
  automation_not_found: '找不到自動化',
};

export function AutomationEditorPage() {
  const navigate = useNavigate();
  const { mediaId } = useParams();
  const [searchParams] = useSearchParams();
  const automationId = searchParams.get('automationId');
  // 無 mediaId 時的套用範圍：next_post（下一篇新貼文）或 account_default（全帳號預設）。
  const scopeParam = searchParams.get('scope');
  const [applyScope, setApplyScope] = useState<string>(
    mediaId ? 'media' : (scopeParam ?? 'next_post'),
  );
  // 限動模式：新建時由首頁帶 ?story=1，編輯既有時由 API 的 media.mediaType 判斷。
  const [storyMode, setStoryMode] = useState(searchParams.get('story') === '1');

  const [name, setName] = useState('');
  const [matchType, setMatchType] = useState<MatchType>('contains_any');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [publicReplyEnabled, setPublicReplyEnabled] = useState(searchParams.get('story') !== '1');
  // 新建（非限動）預填三則繁中範本；編輯既有以伺服器資料為準。
  const [variants, setVariants] = useState<string[]>(
    automationId || searchParams.get('story') === '1' ? [''] : [...DEFAULT_PUBLIC_REPLIES],
  );
  const [privateReplyEnabled, setPrivateReplyEnabled] = useState(true);
  const [openingDm, setOpeningDm] = useState('');
  const [buttonEnabled, setButtonEnabled] = useState(false);
  const [buttonText, setButtonText] = useState('');
  const [buttonUrl, setButtonUrl] = useState('');
  const [dailyLimit, setDailyLimit] = useState('');

  const [status, setStatus] = useState('draft');
  const [savedId, setSavedId] = useState<string | null>(automationId);
  const [loading, setLoading] = useState(Boolean(automationId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activationErrors, setActivationErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!automationId) return;
    try {
      const d = await apiGet<AutomationDetail>(`/api/admin/automations/${automationId}`);
      setName(d.automation.name);
      setMatchType(d.automation.matchType);
      setKeywords(d.keywords);
      setPublicReplyEnabled(d.automation.publicReplyEnabled === 1);
      setVariants(d.publicReplyVariants.length ? d.publicReplyVariants : ['']);
      setPrivateReplyEnabled(d.automation.privateReplyEnabled === 1);
      setOpeningDm(d.automation.openingDm ?? '');
      setButtonEnabled(Boolean(d.automation.buttonUrl));
      setButtonText(d.automation.buttonText ?? '');
      setButtonUrl(d.automation.buttonUrl ?? '');
      setDailyLimit(d.automation.dailyLimit != null ? String(d.automation.dailyLimit) : '');
      setStatus(d.automation.status);
      setApplyScope(d.automation.applyScope ?? 'media');
      if (d.media?.mediaType === 'STORY') {
        setStoryMode(true);
        setPublicReplyEnabled(false);
      }
    } catch (e) {
      if ((e as ApiError).status === 401) navigate('/login');
      else setError((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  }, [automationId, navigate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function addKeyword() {
    const v = keywordDraft.trim();
    if (v && !keywords.includes(v)) setKeywords([...keywords, v]);
    setKeywordDraft('');
  }

  function payload() {
    return {
      ...(mediaId ? { instagramMediaId: mediaId } : { applyScope }),
      name: name.trim(),
      matchType,
      keywords: matchType === 'all_comments' ? [] : keywords,
      // 限動沒有留言串，公開回覆一律關閉。
      publicReplyEnabled: storyMode ? false : publicReplyEnabled,
      publicReplyVariants: storyMode ? [] : variants.map((v) => v.trim()).filter(Boolean),
      privateReplyEnabled,
      openingDm: openingDm.trim(),
      // 沒勾「加上連結按鈕」就送空字串 → 後端發純文字 DM。
      buttonText: buttonEnabled ? buttonText.trim() : '',
      buttonUrl: buttonEnabled ? buttonUrl.trim() : '',
      dailyLimit: dailyLimit ? Number(dailyLimit) : undefined,
    };
  }

  // 儲存：建立用 POST、更新用 PATCH。
  async function handleSave() {
    setError(null);
    setNotice(null);
    setActivationErrors([]);
    if (!name.trim()) {
      setError('請輸入自動化名稱');
      return;
    }
    setBusy(true);
    try {
      let id = savedId;
      if (id) {
        await patch(`/api/admin/automations/${id}`, payload());
      } else {
        const created = await apiPost<{ id: string }>('/api/admin/automations', payload());
        id = created.id;
        setSavedId(id);
      }
      setNotice('已儲存 ✓');
    } catch (e) {
      setError((e as ApiError).message ?? '儲存失敗');
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate() {
    if (!savedId) {
      setError('請先儲存再啟用');
      return;
    }
    setBusy(true);
    setError(null);
    setActivationErrors([]);
    try {
      await apiPost(`/api/admin/automations/${savedId}/activate`, {});
      setStatus('active');
      setNotice('已啟用 ✓');
    } catch (e) {
      const err = e as ApiError & { reasons?: string[] };
      if (err.status === 422 && err.reasons) setActivationErrors(err.reasons);
      else setError(err.message ?? '啟用失敗');
    } finally {
      setBusy(false);
    }
  }

  async function handlePause() {
    if (!savedId) return;
    setBusy(true);
    try {
      await apiPost(`/api/admin/automations/${savedId}/pause`, {});
      setStatus('paused');
      setNotice('已暫停');
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <>
        <AppHeader />
        <div className="container">
          <div className="state-note">載入中…</div>
        </div>
      </>
    );
  }

  return (
    <>
      <AppHeader />
      <div className="container" style={{ maxWidth: 720 }}>
        <Link to="/" className="back-link">
          ← 返回首頁
        </Link>

        <div className="status-line">
          <h1 className="page-title" style={{ margin: 0 }}>
            {storyMode
              ? savedId
                ? '編輯限動自動化'
                : '設定限動自動化'
              : applyScope === 'next_post'
                ? '待命自動化：下一篇新貼文'
                : applyScope === 'account_default'
                  ? '全帳號預設自動化'
                  : savedId
                    ? '編輯自動化'
                    : '設定自動化'}
          </h1>
          {applyScope === 'next_post' ? (
            <span className="badge badge-neutral">待綁定</span>
          ) : null}
          {status === 'active' ? (
            <span className="badge badge-success">啟用中</span>
          ) : status === 'paused' ? (
            <span className="badge badge-warning">已暫停</span>
          ) : (
            <span className="badge badge-neutral">草稿</span>
          )}
        </div>

        {storyMode ? (
          <p className="page-subtitle">
            有人回應這則限時動態、且訊息含關鍵字時，自動私訊指定內容。限動 24 小時後過期，自動化會自動暫停。
          </p>
        ) : applyScope === 'next_post' ? (
          <p className="page-subtitle">
            先把關鍵字與回覆設定好並啟用；下一篇發布的新貼文（含排程貼文上線）會自動接上這組自動化，連第一則留言都不會漏。
          </p>
        ) : applyScope === 'account_default' ? (
          <p className="page-subtitle">
            沒有專屬自動化的貼文都會套用這組設定（每個平台各一組）。個別貼文另外設定的自動化優先於此預設。
          </p>
        ) : null}

        {error ? <div className="alert alert-danger" style={{ marginBottom: 'var(--space-4)' }}>{error}</div> : null}
        {activationErrors.length ? (
          <div className="alert alert-danger" style={{ marginBottom: 'var(--space-4)' }}>
            無法啟用：
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {activationErrors.map((r) => (
                <li key={r}>{ACTIVATION_REASON_TEXT[r] ?? r}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {notice ? (
          <div className="alert" style={{ marginBottom: 'var(--space-4)', color: 'var(--success-fg)', background: 'var(--success-bg)' }}>
            {notice}
          </div>
        ) : null}

        <div className="card">
          {/* 基本 */}
          <div className="form-section">
            <div className="form-field">
              <label className="label" htmlFor="name">自動化名稱</label>
              <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：ADHD GitHub 自動回覆" />
            </div>
            <div className="form-field">
              <label className="label" htmlFor="match">比對模式</label>
              <select id="match" className="select" value={matchType} onChange={(e) => setMatchType(e.target.value as MatchType)}>
                <option value="contains_any">包含任一關鍵字（contains_any）</option>
                <option value="exact_any">完全等於任一關鍵字（exact_any）</option>
                <option value="all_comments">所有留言都觸發（all_comments）</option>
              </select>
            </div>

            {matchType !== 'all_comments' ? (
              <div className="form-field">
                <label className="label">關鍵字</label>
                <div className="chips">
                  {keywords.map((k) => (
                    <span className="chip" key={k}>
                      {k}
                      <button type="button" onClick={() => setKeywords(keywords.filter((x) => x !== k))} aria-label="移除">
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  className="input"
                  value={keywordDraft}
                  onChange={(e) => setKeywordDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addKeyword();
                    }
                  }}
                  onBlur={addKeyword}
                  placeholder="輸入關鍵字後按 Enter"
                />
                <p className="field-help">
                  {storyMode
                    ? '限動回應（正規化後）符合任一關鍵字即觸發私訊。大小寫、全形半形、繁簡體會自動互通。'
                    : '留言（正規化後）符合任一關鍵字即觸發。大小寫、全形半形、繁簡體會自動互通（寫繁體，簡體留言也會觸發）。'}
                </p>
              </div>
            ) : null}
          </div>

          {/* 公開回覆（限動沒有留言串，整區隱藏） */}
          {storyMode ? null : (
          <div className="form-section">
            <div className="toggle-row">
              <input id="pub" type="checkbox" checked={publicReplyEnabled} onChange={(e) => setPublicReplyEnabled(e.target.checked)} />
              <label htmlFor="pub">啟用公開回覆（在留言底下公開回一則）</label>
            </div>
            {publicReplyEnabled ? (
              <>
                {variants.map((v, i) => (
                  <div className="variant-row" key={i}>
                    <input className="input" value={v} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`公開回覆版本 ${i + 1}（例如：已私訊你囉 📩）`} />
                    {variants.length > 1 ? (
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => setVariants(variants.filter((_, j) => j !== i))}>
                        移除
                      </button>
                    ) : null}
                  </div>
                ))}
                {variants.length < 5 ? (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => setVariants([...variants, ''])}>
                    ＋ 新增版本
                  </button>
                ) : null}
                <p className="field-help">多個版本會隨機挑一則回覆，最多 5 個。</p>
              </>
            ) : null}
          </div>
          )}

          {/* Private Reply */}
          <div className="form-section">
            <div className="toggle-row">
              <input id="dm" type="checkbox" checked={privateReplyEnabled} onChange={(e) => setPrivateReplyEnabled(e.target.checked)} />
              <label htmlFor="dm">啟用 Private Reply（私訊留言者一則 DM）</label>
            </div>
            {privateReplyEnabled ? (
              <>
                <div className="form-field">
                  <label className="label" htmlFor="odm">私訊內容</label>
                  <textarea id="odm" className="textarea" value={openingDm} onChange={(e) => setOpeningDm(e.target.value)} placeholder="這是影片中介紹的 GitHub 專案：&#10;https://github.com/..." />
                  <p className="field-help">系統只會發這一則私訊。連結可以直接貼在文字裡。</p>
                </div>

                <div className="toggle-row">
                  <input id="btn" type="checkbox" checked={buttonEnabled} onChange={(e) => setButtonEnabled(e.target.checked)} />
                  <label htmlFor="btn">加上可點擊的連結按鈕（選填）</label>
                </div>
                {buttonEnabled ? (
                  <>
                    <p className="field-help" style={{ marginTop: 0, marginBottom: 'var(--space-3)' }}>
                      IG 私訊裡純文字的連結不一定可點；加按鈕能保證有一個可點擊的連結。
                    </p>
                    <div className="form-field">
                      <label className="label" htmlFor="btntext">按鈕文字</label>
                      <input id="btntext" className="input" value={buttonText} onChange={(e) => setButtonText(e.target.value)} placeholder="開啟 GitHub" />
                    </div>
                    <div className="form-field">
                      <label className="label" htmlFor="btnurl">按鈕網址（HTTPS）</label>
                      <input id="btnurl" className="input" value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)} placeholder="https://github.com/..." />
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
          </div>

          {/* 進階 */}
          <div className="form-section">
            <div className="form-field">
              <label className="label" htmlFor="daily">每日觸發上限（選填）</label>
              <input id="daily" className="input" type="number" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} placeholder="例如 2000" />
            </div>
          </div>

          <div className="btn-row">
            {!savedId ? <span className="field-help" style={{ margin: 0 }}>先儲存才能啟用</span> : null}
            <button className="btn btn-outline" onClick={handleSave} disabled={busy}>
              {busy ? '處理中…' : '儲存'}
            </button>
            {status !== 'active' ? (
              <button className="btn btn-primary" onClick={handleActivate} disabled={busy || !savedId}>
                啟用
              </button>
            ) : (
              <button className="btn btn-danger" onClick={handlePause} disabled={busy}>
                暫停
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// PATCH helper（apiPost 只做 POST，這裡補一個 PATCH）。
async function patch<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const d = (await res.json()) as { error?: string };
      if (d.error) message = d.error;
    } catch {
      /* ignore */
    }
    throw { status: res.status, message } as ApiError;
  }
  return (await res.json()) as T;
}
