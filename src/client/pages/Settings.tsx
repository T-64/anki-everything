import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, ChevronLeft, LoaderCircle } from "lucide-react";
import { api, ApiError, forgetKey, type Settings as SettingsData, type SettingsView } from "../api";
import { useBack } from "../back";
import { copy } from "../i18n";
import { useStore } from "../store";
import { Section, haptic, spring } from "../ui";

/** 设置：两个 prompt、语言三项、牌组。prompt 空着就用示例（灰字显示） */
export function Settings() {
  const close = useStore((state) => state.closeSettings);
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<SettingsData | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  useBack(() => {
    close();
    return true;
  });

  useEffect(() => {
    api
      .settings()
      .then((loaded) => {
        setView(loaded);
        setDraft(loaded.settings);
      })
      .catch(() => setError(copy.common.networkError));
  }, []);

  const edit = (patch: Partial<SettingsData>) => {
    setDraft((current) => current && { ...current, ...patch });
    setState("idle");
  };
  const changed = Boolean(view && draft && JSON.stringify(view.settings) !== JSON.stringify(draft));

  const save = async () => {
    if (!draft) return;
    setState("saving");
    setError(null);
    try {
      const saved = await api.saveSettings(draft);
      setView(saved);
      setDraft(saved.settings);
      setState("saved");
      haptic.success();
      // 牌组可能改了：重新取一次配置
      const config = await api.config();
      useStore.setState({ config });
    } catch (failure) {
      setState("idle");
      setError(failure instanceof ApiError ? (copy.errors[failure.code as keyof typeof copy.errors] ?? copy.errors.unknown) : copy.common.networkError);
    }
  };

  const logout = () => {
    forgetKey();
    useStore.setState({ authed: false, settingsOpen: false, captures: null, config: null });
  };

  const field = (key: keyof SettingsData, label: string) => (
    <label className="setting-field">
      <span>{label}</span>
      <input className="field" value={draft?.[key] ?? ""} onChange={(event) => edit({ [key]: event.target.value })} />
    </label>
  );

  return (
    <motion.div className="settings" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={spring}>
      <div className="statusbar" aria-hidden="true" />
      <header className="settings-head">
        <button className="head-button" aria-label={copy.common.back} onClick={close}>
          <ChevronLeft />
        </button>
        <h1 className="sheet-title">{copy.settings.title}</h1>
      </header>

      {!draft && !error && <p className="empty">{copy.common.loading}</p>}
      {draft && view && (
        <div className="settings-body">
          <Section title={copy.settings.language}>
            <textarea
              className="field prompt-field"
              rows={8}
              placeholder={view.examples.language}
              value={draft.language_prompt}
              onChange={(event) => edit({ language_prompt: event.target.value })}
            />
            <div className="setting-row">
              {field("source_lang", copy.settings.sourceLang)}
              {field("target_lang", copy.settings.targetLang)}
              {field("level", copy.settings.level)}
            </div>
          </Section>
          <Section title={copy.settings.general}>
            <textarea
              className="field prompt-field"
              rows={8}
              placeholder={view.examples.general}
              value={draft.general_prompt}
              onChange={(event) => edit({ general_prompt: event.target.value })}
            />
          </Section>
          <Section title={copy.settings.deck}>
            <input className="field" value={draft.deck} onChange={(event) => edit({ deck: event.target.value })} />
          </Section>
          <button className="text-action logout" onClick={logout}>
            {copy.settings.logout}
          </button>
        </div>
      )}
      {error && <p className="hint danger-text settings-error">{error}</p>}

      <div className="actions">
        <button className="primary" disabled={!changed || state === "saving"} onClick={() => void save()}>
          {state === "saving" ? <LoaderCircle className="spin" /> : state === "saved" && !changed ? <Check /> : null}
          {state === "saved" && !changed ? copy.settings.saved : copy.settings.save}
        </button>
      </div>
    </motion.div>
  );
}
