import { useMemo, type ChangeEvent } from "react";
import { motion } from "motion/react";
import { Camera, Check, CheckCheck, Images, LoaderCircle, Settings2, TriangleAlert } from "lucide-react";
import { copy } from "../i18n";
import { confirmable, effectiveFilter, isTodo, useStore, type Filter } from "../store";
import { ask, haptic, useImage } from "../ui";
import { focusText, type CaptureView } from "../../shared/capture";
import type { PendingCapture } from "../offline";

const FILTERS: Filter[] = ["todo", "all", "done"];

const matches = (filter: Filter, item: CaptureView) => (filter === "all" ? true : filter === "todo" ? isTodo(item) : item.status === "confirmed" || item.status === "in_anki");

/** AnkiDroid 相关的提示：只在真的有卡要写、或者需要你做点什么时出现 */
function AnkiNotice() {
  const { anki, ankiError, captures, grant, openAnki } = useStore();
  const waiting = (captures ?? []).some((item) => item.status === "confirmed");
  if (ankiError)
    return (
      <div className="notice danger">
        <p>{copy.anki.writeFailed(ankiError)}</p>
      </div>
    );
  if (!anki || anki.ok) return null;
  if (anki.reason === "no_permission") {
    return (
      <div className="notice">
        <p>{copy.anki.needPermission}</p>
        <button className="notice-action" onClick={() => void grant()}>
          {copy.anki.grant}
        </button>
      </div>
    );
  }
  if (anki.reason === "not_installed")
    return (
      <div className="notice">
        <p>{copy.anki.notInstalled}</p>
      </div>
    );
  if (!waiting) return null;
  if (anki.reason === "not_running") {
    return (
      <div className="notice">
        <p>{copy.anki.notRunning}</p>
        <button className="notice-action" onClick={openAnki}>
          {copy.anki.openAnki}
        </button>
        <p className="notice-hint">{copy.anki.notRunningHint}</p>
      </div>
    );
  }
  return (
    <div className="notice">
      <p>{copy.anki.webOnly}</p>
    </div>
  );
}

/** 筛选栏右边的小按钮：待确认的照片按 AI 推荐一次全部做成卡片（想改哪张，先点开那张改） */
function ConfirmAll() {
  const captures = useStore((state) => state.captures);
  const bulk = useStore((state) => state.bulk);
  const confirmAll = useStore((state) => state.confirmAll);
  const count = confirmable(captures ?? []).length;
  if (count === 0 && !bulk) return null;
  const run = async () => {
    if (!(await ask(copy.home.confirmAllAsk(count), copy.home.confirmAllGo))) return;
    haptic.tap();
    if ((await confirmAll()) === 0) haptic.success();
  };
  return (
    <button className="bulk-button" aria-label={copy.home.confirmAllGo} disabled={bulk !== null} onClick={() => void run()}>
      {bulk ? <LoaderCircle className="spin" /> : <CheckCheck />}
      {bulk && (
        <span className="bulk-progress">
          {bulk.done}/{bulk.total}
        </span>
      )}
    </button>
  );
}

/** 压在照片上的那句：语言做法是重点句，其他做法是正面 */
function tileText(item: CaptureView): string | null {
  if (!item.card) return null;
  if (item.mode === "language") return item.card.language_ok ? focusText(item.card) : null;
  return item.card.front.trim() || null;
}

/** 照片墙上的一张：照片 + 压在上面的重点句 */
function Tile({ item }: { item: CaptureView }) {
  const thumb = useImage(item.id, "thumb");
  const open = useStore((state) => state.open);
  const text = tileText(item);
  return (
    <button className={`tile tile-${item.status}`} onClick={() => (haptic.tap(), open(item.id))}>
      <div className="tile-photo">
        {thumb ? <motion.img layoutId={`photo-${item.id}`} src={thumb} alt="" /> : <div className="tile-placeholder" />}
        {item.status === "analyzing" && <span className="scanline" aria-hidden="true" />}
      </div>
      <TileStatus status={item.status} />
      {text && (
        <p className="tile-text" lang={item.mode === "language" ? "de" : undefined}>
          {text}
        </p>
      )}
      {!text && item.question && <p className="tile-text tile-question">{item.question}</p>}
    </button>
  );
}

function TileStatus({ status }: { status: CaptureView["status"] | "uploading" }) {
  const label = copy.status[status as keyof typeof copy.status];
  const icon =
    status === "analyzing" || status === "uploading" ? <LoaderCircle className="spin" /> : status === "in_anki" ? <Check /> : status === "failed" ? <TriangleAlert /> : null;
  return (
    <span className={`tile-status status-${status}`}>
      {icon}
      {label}
    </span>
  );
}

/** 还在手机上排队的照片 */
function PendingTile({ item }: { item: PendingCapture }) {
  return (
    <div className="tile tile-uploading">
      <div className="tile-photo">
        <img src={item.thumb ?? item.image} alt="" />
      </div>
      <TileStatus status="uploading" />
      {item.question && <p className="tile-text tile-question">{item.question}</p>}
    </div>
  );
}

/** 两列错落排：按顺序左右交替，最新的在最上面 */
function Wall({ items, pending }: { items: CaptureView[]; pending: PendingCapture[] }) {
  const cells = [...pending.map((item) => ({ key: item.id, node: <PendingTile item={item} /> })), ...items.map((item) => ({ key: item.id, node: <Tile item={item} /> }))];
  const columns = [cells.filter((_, index) => index % 2 === 0), cells.filter((_, index) => index % 2 === 1)];
  return (
    <div className="wall">
      {columns.map((column, index) => (
        <div className="wall-column" key={index}>
          {column.map((cell) => (
            <div key={cell.key}>{cell.node}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Home() {
  const { captures, pending, filter, setFilter, networkError, pick, openSettings } = useStore();
  const active = effectiveFilter(filter, captures);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((key) => [key, (captures ?? []).filter((item) => matches(key, item)).length])) as Record<Filter, number>, [captures]);
  const shown = (captures ?? []).filter((item) => matches(active, item));
  const shownPending = active === "done" ? [] : pending;

  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void pick(file);
  };

  return (
    <main className="home">
      <header className="home-head">
        <div className="home-title">
          <h1 className="wordmark">
            <span className="wordmark-top">{copy.wordmark.top}</span>
            <span className="wordmark-main">{copy.wordmark.main}</span>
          </h1>
          <button className="head-button" aria-label={copy.home.settings} onClick={() => (haptic.tap(), openSettings())}>
            <Settings2 />
          </button>
        </div>
        <div className="filter-row">
          <nav className="filters" aria-label={copy.home.filterLabel}>
            {FILTERS.map((key) => (
              <button key={key} className={`filter ${active === key ? "on" : ""}`} aria-pressed={active === key} onClick={() => (haptic.tap(), setFilter(key))}>
                {active === key && <motion.span layoutId="filter-pill" className="filter-pill" transition={{ type: "spring", damping: 30, stiffness: 400 }} />}
                <span className="filter-label">{copy.home.filters[key]}</span>
                <span className="filter-count">{counts[key]}</span>
              </button>
            ))}
          </nav>
          {active === "todo" && <ConfirmAll />}
        </div>
      </header>

      <AnkiNotice />
      {networkError && (
        <div className="notice danger">
          <p>{copy.common.networkError}</p>
        </div>
      )}
      {pending.length > 0 && (
        <div className="notice">
          <p>{copy.home.pendingUpload(pending.length)}</p>
        </div>
      )}

      {captures === null && !networkError && <p className="empty">{copy.common.loading}</p>}
      {captures !== null && shown.length === 0 && shownPending.length === 0 && <p className="empty">{copy.home.empty[active]}</p>}
      <Wall items={shown} pending={shownPending} />

      <div className="dock">
        <label className="dock-side" aria-label={copy.home.gallery}>
          <Images />
          <input type="file" accept="image/*" hidden onChange={picked} />
        </label>
        <label className="dock-camera" aria-label={copy.home.camera}>
          <Camera />
          <input type="file" accept="image/*" capture="environment" hidden onChange={picked} />
        </label>
        <span className="dock-side" aria-hidden="true" />
      </div>
    </main>
  );
}
