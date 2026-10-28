import { useState, type FormEvent } from "react";
import { checkKey, needsServer, normalizeServer, saveKey, saveServer, savedServer } from "../api";
import { copy } from "../i18n";
import { useStore } from "../store";

export function Login() {
  const login = useStore((state) => state.login);
  // App 里要填服务器地址；Web 版和 API 同源，不显示
  const [server, setServer] = useState(savedServer());
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = key.trim() !== "" && (!needsServer || server.trim() !== "");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const base = needsServer ? normalizeServer(server) : "";
    try {
      if (await checkKey(base, key.trim())) {
        if (needsServer) saveServer(base);
        saveKey(key.trim());
        login();
      } else {
        setError(copy.login.wrong);
      }
    } catch {
      setError(copy.common.networkError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <h1 className="wordmark wordmark-large">
        <span className="wordmark-top">{copy.wordmark.top}</span>
        <span className="wordmark-main">{copy.wordmark.main}</span>
      </h1>
      <form onSubmit={submit}>
        {needsServer && (
          <input
            className="field"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={copy.login.server}
            placeholder={copy.login.serverPlaceholder}
            value={server}
            onChange={(event) => setServer(event.target.value)}
          />
        )}
        <input
          className="field"
          type="password"
          autoComplete="current-password"
          aria-label={copy.login.label}
          placeholder={copy.login.label}
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
        {error && <p className="hint danger-text">{error}</p>}
        <button className="primary wide" disabled={busy || !ready}>
          {copy.login.submit}
        </button>
      </form>
    </main>
  );
}
