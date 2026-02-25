import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminApiError, type AdminApi, type SearchSourceMode, type ServerInfoDto } from '../lib/adminApi';
import { IconLogout, IconRefresh, IconSettings } from '../ui/icons';
import { useToast } from '../ui/toast';
import { supportedLanguages, changeLanguage, getCurrentLanguage, type SupportedLocale } from '../i18n';

export function SettingsPage({
  api,
  value,
  signedIn,
  onChange,
  onGoToLogin,
  onSignOut
}: {
  api: AdminApi;
  value: { apiBaseUrl: string; locale: SupportedLocale };
  signedIn: boolean;
  onChange: (next: { apiBaseUrl: string; locale: SupportedLocale }) => void;
  onGoToLogin: () => void;
  onSignOut: () => void;
}) {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const toast = useToast();
  const [testing, setTesting] = useState(false);
  const [serverInfo, setServerInfo] = useState<ServerInfoDto | null>(null);
  const [serverInfoError, setServerInfoError] = useState<string | null>(null);
  const [serverStrategyDraft, setServerStrategyDraft] = useState<'round_robin' | 'random'>('round_robin');
  const [savingServerStrategy, setSavingServerStrategy] = useState(false);
  const [searchSourceModeDraft, setSearchSourceModeDraft] = useState<SearchSourceMode>('brave_prefer_tavily_fallback');
  const [savingSearchSourceMode, setSavingSearchSourceMode] = useState(false);
  const [savingResearch, setSavingResearch] = useState(false);
  const [grokSearchEnabledDraft, setGrokSearchEnabledDraft] = useState(false);
  const [grokModelDraft, setGrokModelDraft] = useState('grok-4.2-beta');
  const [grokExtraSourcesDraft, setGrokExtraSourcesDraft] = useState<number | ''>(0);
  const [grokSourceModeDraft, setGrokSourceModeDraft] = useState<SearchSourceMode>('combined');
  const [grokKeyStrategyDraft, setGrokKeyStrategyDraft] = useState<'round_robin' | 'random'>('round_robin');
  const [savingGrokSettings, setSavingGrokSettings] = useState(false);
  const [grokProviderBaseUrlDraft, setGrokProviderBaseUrlDraft] = useState('https://api.x.ai/v1');
  const [grokProviderBaseUrlSaved, setGrokProviderBaseUrlSaved] = useState('https://api.x.ai/v1');
  const [grokProviderApiKeyDraft, setGrokProviderApiKeyDraft] = useState('');
  const [grokProviderApiKeyConfigured, setGrokProviderApiKeyConfigured] = useState(false);
  const [grokProviderApiKeyMasked, setGrokProviderApiKeyMasked] = useState<string | null>(null);
  const [savingGrokProvider, setSavingGrokProvider] = useState(false);
  const baseUrlNeedsScheme = useMemo(() => value.apiBaseUrl.trim() !== '' && !/^https?:\/\//.test(value.apiBaseUrl.trim()), [value.apiBaseUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!signedIn) {
      setServerInfo(null);
      setServerInfoError(null);
      setGrokProviderApiKeyDraft('');
      return;
    }
    setServerInfoError(null);
    api
      .getServerInfo()
      .then(async (info) => {
        if (cancelled) return;
        let provider = {
          baseUrl: info.grokProviderBaseUrl ?? 'https://api.x.ai/v1',
          apiKeyConfigured: Boolean(info.grokProviderApiKeyConfigured),
          apiKeyMasked: info.grokProviderApiKeyMasked ?? null
        };
        try {
          provider = await api.getGrokProviderConfig();
        } catch {
          // Fallback to server-info metadata for backwards compatibility.
        }
        setServerInfo(info);
        setServerStrategyDraft(info.tavilyKeySelectionStrategy);
        setSearchSourceModeDraft(info.searchSourceMode);
        setGrokSearchEnabledDraft(info.grokSearchEnabled);
        setGrokModelDraft(info.grokModelDefault);
        setGrokExtraSourcesDraft(info.grokExtraSourcesDefault);
        setGrokSourceModeDraft(info.grokSearchSourceMode);
        setGrokKeyStrategyDraft(info.grokKeySelectionStrategy);
        setGrokProviderBaseUrlDraft(provider.baseUrl);
        setGrokProviderBaseUrlSaved(provider.baseUrl);
        setGrokProviderApiKeyConfigured(provider.apiKeyConfigured);
        setGrokProviderApiKeyMasked(provider.apiKeyMasked);
        setGrokProviderApiKeyDraft('');
      })
      .catch((e: any) => {
        if (cancelled) return;
        const msg = typeof e?.message === 'string' ? e.message : tc('errors.unknownError');
        setServerInfoError(msg);
      });
    return () => {
      cancelled = true;
    };
  }, [api, signedIn, tc]);

  async function saveServerStrategy(next: 'round_robin' | 'random') {
    if (!signedIn) {
      toast.push({ title: t('toast.signInRequired'), message: t('toast.signInRequiredMessage') });
      return;
    }
    setSavingServerStrategy(true);
    try {
      const res = await api.updateServerInfo({ tavilyKeySelectionStrategy: next });
      setServerInfo(res);
      setServerStrategyDraft(res.tavilyKeySelectionStrategy);
      toast.push({ title: t('toast.updated'), message: t('toast.updatedMessage', { strategy: res.tavilyKeySelectionStrategy }) });
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : tc('errors.unknownError');
      toast.push({ title: t('toast.updateFailed'), message: msg });
    } finally {
      setSavingServerStrategy(false);
    }
  }

  async function saveSearchSourceMode(next: SearchSourceMode) {
    if (!signedIn) {
      toast.push({ title: t('toast.signInRequired'), message: t('toast.signInRequiredMessage') });
      return;
    }
    setSavingSearchSourceMode(true);
    try {
      const res = await api.updateServerInfo({ searchSourceMode: next });
      setServerInfo(res);
      setSearchSourceModeDraft(res.searchSourceMode);
      toast.push({ title: t('toast.searchSourceModeUpdated'), message: t('toast.searchSourceModeUpdatedMessage', { mode: res.searchSourceMode }) });
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : tc('errors.unknownError');
      toast.push({ title: t('toast.updateFailed'), message: msg });
    } finally {
      setSavingSearchSourceMode(false);
    }
  }

  async function toggleResearch(enabled: boolean) {
    if (!signedIn) {
      toast.push({ title: t('toast.signInRequired'), message: t('toast.signInRequiredMessage') });
      return;
    }
    setSavingResearch(true);
    try {
      const res = await api.updateServerInfo({ researchEnabled: enabled });
      setServerInfo(res);
      const status = res.researchEnabled ? t('server.research.enabled').toLowerCase() : t('server.research.disabled').toLowerCase();
      toast.push({ title: t('toast.researchToggled'), message: t('toast.researchToggledMessage', { status }) });
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : tc('errors.unknownError');
      toast.push({ title: t('toast.updateFailed'), message: msg });
    } finally {
      setSavingResearch(false);
    }
  }

  const grokDirty = useMemo(() => {
    if (!serverInfo) return false;
    const draftExtra = typeof grokExtraSourcesDraft === 'number' ? grokExtraSourcesDraft : Number(grokExtraSourcesDraft || 0);
    return (
      grokSearchEnabledDraft !== serverInfo.grokSearchEnabled
      || grokModelDraft.trim() !== serverInfo.grokModelDefault
      || Math.floor(Number.isFinite(draftExtra) ? draftExtra : 0) !== serverInfo.grokExtraSourcesDefault
      || grokSourceModeDraft !== serverInfo.grokSearchSourceMode
      || grokKeyStrategyDraft !== serverInfo.grokKeySelectionStrategy
    );
  }, [
    grokExtraSourcesDraft,
    grokKeyStrategyDraft,
    grokModelDraft,
    grokSearchEnabledDraft,
    grokSourceModeDraft,
    serverInfo
  ]);

  const grokProviderDirty = useMemo(() => {
    return grokProviderBaseUrlDraft.trim() !== grokProviderBaseUrlSaved.trim() || Boolean(grokProviderApiKeyDraft.trim());
  }, [grokProviderApiKeyDraft, grokProviderBaseUrlDraft, grokProviderBaseUrlSaved]);

  async function saveGrokSettings() {
    if (!signedIn) {
      toast.push({ title: t('toast.signInRequired'), message: t('toast.signInRequiredMessage') });
      return;
    }
    const model = grokModelDraft.trim();
    if (!model) {
      toast.push({ title: t('toast.updateFailed'), message: 'Grok model default cannot be empty.' });
      return;
    }
    const extraRaw = typeof grokExtraSourcesDraft === 'number' ? grokExtraSourcesDraft : Number(grokExtraSourcesDraft || 0);
    if (!Number.isFinite(extraRaw) || extraRaw < 0 || extraRaw > 20) {
      toast.push({ title: t('toast.updateFailed'), message: 'Grok extra sources default must be between 0 and 20.' });
      return;
    }

    setSavingGrokSettings(true);
    try {
      const res = await api.updateServerInfo({
        grokSearchEnabled: grokSearchEnabledDraft,
        grokModelDefault: model,
        grokExtraSourcesDefault: Math.floor(extraRaw),
        grokSearchSourceMode: grokSourceModeDraft,
        grokKeySelectionStrategy: grokKeyStrategyDraft
      });
      setServerInfo(res);
      setGrokSearchEnabledDraft(res.grokSearchEnabled);
      setGrokModelDraft(res.grokModelDefault);
      setGrokExtraSourcesDraft(res.grokExtraSourcesDefault);
      setGrokSourceModeDraft(res.grokSearchSourceMode);
      setGrokKeyStrategyDraft(res.grokKeySelectionStrategy);
      toast.push({ title: t('toast.updated'), message: 'Grok settings updated.' });
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : tc('errors.unknownError');
      toast.push({ title: t('toast.updateFailed'), message: msg });
    } finally {
      setSavingGrokSettings(false);
    }
  }

  async function saveGrokProvider() {
    if (!signedIn) {
      toast.push({ title: t('toast.signInRequired'), message: t('toast.signInRequiredMessage') });
      return;
    }
    const baseUrl = grokProviderBaseUrlDraft.trim();
    const nextApiKey = grokProviderApiKeyDraft.trim();
    const payload: { baseUrl?: string; apiKey?: string } = {};
    if (baseUrl !== grokProviderBaseUrlSaved.trim()) {
      payload.baseUrl = baseUrl;
    }
    if (nextApiKey) {
      payload.apiKey = nextApiKey;
    }
    if (!payload.baseUrl && !payload.apiKey) {
      return;
    }

    setSavingGrokProvider(true);
    try {
      const updated = await api.updateGrokProviderConfig(payload);
      setGrokProviderBaseUrlDraft(updated.baseUrl);
      setGrokProviderBaseUrlSaved(updated.baseUrl);
      setGrokProviderApiKeyConfigured(updated.apiKeyConfigured);
      setGrokProviderApiKeyMasked(updated.apiKeyMasked);
      setGrokProviderApiKeyDraft('');
      toast.push({ title: t('toast.updated'), message: 'Grok provider connection updated.' });
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : tc('errors.unknownError');
      toast.push({ title: t('toast.updateFailed'), message: msg });
    } finally {
      setSavingGrokProvider(false);
    }
  }

  async function clearGrokProviderApiKey() {
    if (!signedIn) {
      toast.push({ title: t('toast.signInRequired'), message: t('toast.signInRequiredMessage') });
      return;
    }
    setSavingGrokProvider(true);
    try {
      const updated = await api.updateGrokProviderConfig({ clearApiKey: true });
      setGrokProviderBaseUrlDraft(updated.baseUrl);
      setGrokProviderBaseUrlSaved(updated.baseUrl);
      setGrokProviderApiKeyConfigured(updated.apiKeyConfigured);
      setGrokProviderApiKeyMasked(updated.apiKeyMasked);
      setGrokProviderApiKeyDraft('');
      toast.push({ title: t('toast.updated'), message: 'Saved Grok provider API key cleared.' });
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : tc('errors.unknownError');
      toast.push({ title: t('toast.updateFailed'), message: msg });
    } finally {
      setSavingGrokProvider(false);
    }
  }

  async function testConnection() {
    if (!signedIn) {
      toast.push({ title: t('toast.signInRequired'), message: t('toast.goToLoginMessage') });
      return;
    }
    setTesting(true);
    try {
      await api.listKeys();
      toast.push({ title: t('toast.connected'), message: t('toast.connectedMessage') });
    } catch (e: any) {
      const status = typeof e?.status === 'number' ? e.status : null;
      if (e instanceof AdminApiError && status === 401) {
        toast.push({
          title: t('toast.authFailed'),
          message: t('toast.authFailedMessage')
        });
      } else if (e instanceof AdminApiError && status === 404) {
        toast.push({
          title: t('toast.notFound'),
          message: t('toast.notFoundMessage')
        });
      } else if (e instanceof AdminApiError && status === 0) {
        toast.push({
          title: t('toast.networkError'),
          message: t('toast.networkErrorMessage')
        });
      } else {
        toast.push({ title: t('toast.connectionFailed'), message: typeof e?.message === 'string' ? e.message : tc('errors.unknownError') });
      }
    } finally {
      setTesting(false);
    }
  }

  function handleLanguageChange(locale: SupportedLocale) {
    changeLanguage(locale);
    onChange({ ...value, locale });
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="cardHeader">
          <div className="row">
            <div>
              <div className="h2">{t('title')}</div>
              <div className="help">{t('subtitle')}</div>
            </div>
            <button className="btn" onClick={testConnection} disabled={testing}>
              <IconRefresh />
              {t('actions.testConnection')}
            </button>
          </div>
        </div>
        <div className="cardBody">
          <div className="stack">
            <div className="grid2">
              <div className="stack">
                <label htmlFor="api-base-url-input" className="label">{t('apiBaseUrl.label')}</label>
                <input
                  id="api-base-url-input"
                  className="input mono"
                  value={value.apiBaseUrl}
                  onChange={(e) => onChange({ ...value, apiBaseUrl: e.target.value })}
                  placeholder={t('apiBaseUrl.placeholder')}
                  autoComplete="off"
                />
                <div className="help" dangerouslySetInnerHTML={{ __html: t('apiBaseUrl.help').replace(/<mono>/g, '<span class="mono">').replace(/<\/mono>/g, '</span>') }} />
                {baseUrlNeedsScheme ? (
                  <div className="badge mono" data-variant="warning">
                    {t('apiBaseUrl.schemeTip')}
                  </div>
                ) : null}
              </div>
              <div className="stack">
                <div className="label">{t('auth.label')}</div>
                <div className="help">
                  {t('auth.status')}{' '}
                  {signedIn ? (
                    <span className="badge mono" data-variant="success">
                      {t('auth.signedIn')}
                    </span>
                  ) : (
                    <span className="badge mono" data-variant="danger">
                      {t('auth.signedOut')}
                    </span>
                  )}
                </div>
                <div className="flex gap-3 items-center flex-wrap">
                  {signedIn ? (
                    <button className="btn" data-variant="ghost" onClick={onGoToLogin}>
                      {t('auth.changeToken')}
                    </button>
                  ) : (
                    <button className="btn" data-variant="primary" onClick={onGoToLogin}>
                      {tc('actions.signIn')}
                    </button>
                  )}
                  {signedIn ? (
                    <button className="btn" data-variant="danger" onClick={onSignOut}>
                      <IconLogout />
                      {tc('actions.signOut')}
                    </button>
                  ) : null}
                </div>
                <div className="help">{t('auth.help')}</div>
              </div>
            </div>

            <div className="stack">
              <label htmlFor="language-select" className="label">{t('language.label')}</label>
              <select
                id="language-select"
                className="select"
                value={getCurrentLanguage()}
                onChange={(e) => handleLanguageChange(e.target.value as SupportedLocale)}
              >
                {supportedLanguages.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name}
                  </option>
                ))}
              </select>
              <div className="help">{t('language.help')}</div>
            </div>

            <div className="grid2">
              <div className="stack">
                <div className="label">{t('server.label')}</div>
                {!signedIn ? (
                  <div className="help">{t('server.signInRequired')}</div>
                ) : serverInfoError ? (
                  <div className="badge mono" data-variant="warning">
                    {t('server.loadError')}
                  </div>
                ) : serverInfo ? (
                  <div className="stack">
                    <div className="flex gap-3 items-center">
                      <div className="help">{t('server.keySelection')}</div>
                      <span className="badge mono" data-variant="info">
                        {serverInfo.tavilyKeySelectionStrategy}
                      </span>
                    </div>
                    <div className="flex gap-3 items-center flex-wrap">
                      <select
                        className="select"
                        value={serverStrategyDraft}
                        onChange={(e) => setServerStrategyDraft(e.target.value === 'random' ? 'random' : 'round_robin')}
                        disabled={savingServerStrategy}
                        aria-label={t('server.keySelection')}
                      >
                        <option value="round_robin">{t('server.roundRobin')}</option>
                        <option value="random">{t('server.random')}</option>
                      </select>
                      <button
                        className="btn btn--sm"
                        data-variant="primary"
                        onClick={() => saveServerStrategy(serverStrategyDraft)}
                        disabled={savingServerStrategy || serverStrategyDraft === serverInfo.tavilyKeySelectionStrategy}
                      >
                        {savingServerStrategy ? tc('status.saving') : tc('actions.save')}
                      </button>
                    </div>
                    <div className="help" dangerouslySetInnerHTML={{ __html: t('server.keySelectionHelp').replace(/<mono>/g, '<span class="mono">').replace(/<\/mono>/g, '</span>') }} />

                    <div className="flex gap-3 items-center mt-4">
                      <div className="help">{t('server.searchSourceMode.label')}</div>
                      <span className="badge mono" data-variant="info">
                        {serverInfo.searchSourceMode}
                      </span>
                    </div>
                    <div className="flex gap-3 items-center flex-wrap">
                      <select
                        className="select"
                        value={searchSourceModeDraft}
                        onChange={(e) => setSearchSourceModeDraft(e.target.value as SearchSourceMode)}
                        disabled={savingSearchSourceMode}
                        aria-label={t('server.searchSourceMode.label')}
                      >
                        <option value="brave_prefer_tavily_fallback">{t('server.searchSourceMode.brave_prefer_tavily_fallback')}</option>
                        <option value="combined">{t('server.searchSourceMode.combined')}</option>
                        <option value="tavily_only">{t('server.searchSourceMode.tavily_only')}</option>
                        <option value="brave_only">{t('server.searchSourceMode.brave_only')}</option>
                      </select>
                      <button
                        className="btn btn--sm"
                        data-variant="primary"
                        onClick={() => saveSearchSourceMode(searchSourceModeDraft)}
                        disabled={savingSearchSourceMode || searchSourceModeDraft === serverInfo.searchSourceMode}
                      >
                        {savingSearchSourceMode ? tc('status.saving') : tc('actions.save')}
                      </button>
                    </div>
                    <div className="help">{t('server.searchSourceMode.help')}</div>

                    {searchSourceModeDraft === 'combined' && (
                      <div className="help" style={{ color: 'var(--color-warning)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                        ⚠️ {t('server.searchSourceMode.costNote')}
                      </div>
                    )}

                    {searchSourceModeDraft === 'brave_only' && !serverInfo.braveSearchEnabled ? (
                      <div className="badge mono" data-variant="warning">
                        {t('server.searchSourceMode.braveUnavailableWarning')}
                      </div>
                    ) : null}

                    {searchSourceModeDraft === 'combined' && !serverInfo.braveSearchEnabled ? (
                      <div className="badge mono" data-variant="warning">
                        {t('server.searchSourceMode.combinedUnavailableWarning')}
                      </div>
                    ) : null}

                    <div className="flex gap-3 items-center mt-4">
                      <div className="help">{t('server.research.label')}</div>
                      <span className="badge mono" data-variant={serverInfo.researchEnabled ? 'success' : 'danger'}>
                        {serverInfo.researchEnabled ? t('server.research.enabled') : t('server.research.disabled')}
                      </span>
                    </div>
                    <div className="flex gap-3 items-center flex-wrap">
                      <button
                        className="btn btn--sm"
                        data-variant={serverInfo.researchEnabled ? 'danger' : 'primary'}
                        onClick={() => toggleResearch(!serverInfo.researchEnabled)}
                        disabled={savingResearch}
                      >
                        {savingResearch ? tc('status.saving') : (serverInfo.researchEnabled ? t('server.research.disabled') : t('server.research.enabled'))}
                      </button>
                    </div>
                    <div className="help">{t('server.research.help')}</div>

                    <div className="flex gap-3 items-center mt-4">
                      <div className="help">GrokSearch</div>
                      <span className="badge mono" data-variant={serverInfo.grokSearchEnabled ? 'success' : 'danger'}>
                        {serverInfo.grokSearchEnabled ? 'enabled' : 'disabled'}
                      </span>
                      <span className="badge mono" data-variant="info">
                        active keys: {serverInfo.grokActiveKeyCount}
                      </span>
                    </div>
                    <div className="grid2">
                      <div className="stack">
                        <label className="label" htmlFor="grok-enabled-check">Enable Grok tools</label>
                        <label className="flex gap-2 items-center" htmlFor="grok-enabled-check">
                          <input
                            id="grok-enabled-check"
                            type="checkbox"
                            checked={grokSearchEnabledDraft}
                            onChange={(e) => setGrokSearchEnabledDraft(e.target.checked)}
                            disabled={savingGrokSettings}
                          />
                          <span className="help">Expose web_search/get_sources/web_fetch/web_map</span>
                        </label>
                      </div>
                      <div className="stack">
                        <label className="label" htmlFor="grok-model-input">Default Grok model</label>
                        <input
                          id="grok-model-input"
                          className="input mono"
                          value={grokModelDraft}
                          onChange={(e) => setGrokModelDraft(e.target.value)}
                          disabled={savingGrokSettings}
                          placeholder="grok-4.2-beta"
                        />
                      </div>
                      <div className="stack">
                        <label className="label" htmlFor="grok-extra-input">Default extra sources (0-20)</label>
                        <input
                          id="grok-extra-input"
                          className="input mono"
                          type="number"
                          min={0}
                          max={20}
                          value={grokExtraSourcesDraft}
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            if (!raw) {
                              setGrokExtraSourcesDraft('');
                              return;
                            }
                            const parsed = Number(raw);
                            setGrokExtraSourcesDraft(Number.isFinite(parsed) ? Math.max(0, Math.min(20, Math.floor(parsed))) : '');
                          }}
                          disabled={savingGrokSettings}
                        />
                      </div>
                      <div className="stack">
                        <label className="label" htmlFor="grok-source-mode">Grok source mode</label>
                        <select
                          id="grok-source-mode"
                          className="select"
                          value={grokSourceModeDraft}
                          onChange={(e) => setGrokSourceModeDraft(e.target.value as SearchSourceMode)}
                          disabled={savingGrokSettings}
                        >
                          <option value="combined">combined</option>
                          <option value="brave_prefer_tavily_fallback">brave_prefer_tavily_fallback</option>
                          <option value="tavily_only">tavily_only</option>
                          <option value="brave_only">brave_only</option>
                        </select>
                      </div>
                      <div className="stack">
                        <label className="label" htmlFor="grok-key-strategy">Grok key selection strategy</label>
                        <select
                          id="grok-key-strategy"
                          className="select"
                          value={grokKeyStrategyDraft}
                          onChange={(e) => setGrokKeyStrategyDraft(e.target.value === 'random' ? 'random' : 'round_robin')}
                          disabled={savingGrokSettings}
                        >
                          <option value="round_robin">round_robin</option>
                          <option value="random">random</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-3 items-center flex-wrap">
                      <button
                        className="btn btn--sm"
                        data-variant="primary"
                        onClick={saveGrokSettings}
                        disabled={savingGrokSettings || !grokDirty}
                      >
                        {savingGrokSettings ? tc('status.saving') : tc('actions.save')}
                      </button>
                    </div>
                    {grokSearchEnabledDraft && serverInfo.grokActiveKeyCount === 0 && !grokProviderApiKeyConfigured ? (
                      <div className="badge mono" data-variant="warning">
                        GrokSearch is enabled but no Grok keys are active.
                      </div>
                    ) : null}

                    <div className="stack mt-4">
                      <div className="help">Grok provider connection</div>
                      <div className="grid2">
                        <div className="stack">
                          <label className="label" htmlFor="grok-provider-base-url">Grok API base URL</label>
                          <input
                            id="grok-provider-base-url"
                            className="input mono"
                            value={grokProviderBaseUrlDraft}
                            onChange={(e) => setGrokProviderBaseUrlDraft(e.target.value)}
                            disabled={savingGrokProvider}
                            placeholder="https://api.x.ai/v1"
                            autoComplete="off"
                          />
                          <div className="help">Leave empty to use server fallback from environment/default.</div>
                        </div>
                        <div className="stack">
                          <label className="label" htmlFor="grok-provider-api-key">Grok API key</label>
                          <input
                            id="grok-provider-api-key"
                            className="input mono"
                            type="password"
                            value={grokProviderApiKeyDraft}
                            onChange={(e) => setGrokProviderApiKeyDraft(e.target.value)}
                            disabled={savingGrokProvider}
                            placeholder={grokProviderApiKeyConfigured ? 'Configured (enter new key to rotate)' : 'xai-...'}
                            autoComplete="off"
                          />
                          <div className="help">Stored encrypted at rest. Only a masked value is ever returned.</div>
                        </div>
                      </div>
                      <div className="flex gap-3 items-center flex-wrap">
                        {grokProviderApiKeyConfigured ? (
                          <span className="badge mono" data-variant="success">
                            configured: {grokProviderApiKeyMasked ?? '(masked)'}
                          </span>
                        ) : (
                          <span className="badge mono" data-variant="warning">
                            API key not configured
                          </span>
                        )}
                        {grokProviderApiKeyConfigured ? (
                          <button
                            className="btn btn--sm"
                            data-variant="ghost"
                            onClick={clearGrokProviderApiKey}
                            disabled={savingGrokProvider}
                          >
                            Clear saved key
                          </button>
                        ) : null}
                        <button
                          className="btn btn--sm"
                          data-variant="primary"
                          onClick={saveGrokProvider}
                          disabled={savingGrokProvider || !grokProviderDirty}
                        >
                          {savingGrokProvider ? tc('status.saving') : tc('actions.save')}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="help">{tc('status.loading')}</div>
                )}
              </div>
              <div className="stack">
                <div className="label">{t('rotation.label')}</div>
                <div className="help">{t('rotation.help')}</div>
              </div>
            </div>

            <div className="pill">
              <IconSettings />
              <span className="help" dangerouslySetInnerHTML={{ __html: t('pill.envVars').replace(/<mono>/g, '<span class="mono">').replace(/<\/mono>/g, '</span>') }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
