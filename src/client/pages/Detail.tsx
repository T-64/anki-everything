import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronLeft, Circle, CircleCheck, Crop as CropIcon, Highlighter, LoaderCircle, Plus, RotateCcw, Rows3, Trash2, X } from "lucide-react";
import { api, ApiError } from "../api";
import { copy } from "../i18n";
import { localDate } from "../anki";
import { useStore } from "../store";
import { useBack } from "../back";
import { Gloss, Section, Sheet, ask, haptic, spring, useDark, useImage } from "../ui";
import { Crop } from "./Crop";
import { cropImage, type CropRect } from "../crop";
import { MAX_FOCUS, focusText, type CaptureView, type CardData, type CardItem, type LanguageCapture, type NoteCapture, type NoteCard } from "../../shared/capture";
import { cardText, highlight, noteFront, renderBack, renderNoteBack } from "../../shared/render";

const errorText = (failure: unknown) => (failure instanceof ApiError ? (copy.errors[failure.code as keyof typeof copy.errors] ?? copy.errors.unknown) : copy.common.networkError);

/** 详情：叠在首页上面的一层。照片从照片墙里放大过来，讲解像一张纸从下面盖上来 */
export function Detail({ id }: { id: string }) {
  const close = useStore((state) => state.close);
  const replace = useStore((state) => state.replace);
  const fromList = useStore((state) => state.captures?.find((item) => item.id === id) ?? null);
  const [capture, setCapture] = useState<CaptureView | null>(fromList);
  const thumb = useImage(id, "thumb");
  const original = useImage(id, "original");

  useBack(() => {
    close();
    return true;
  });

  // 打开时取最新的；识别中每 3 秒看一次
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const load = async () => {
      try {
        const next = await api.get(id);
        if (!alive) return;
        setCapture(next);
        replace(next);
        if (next.status === "analyzing") timer = window.setTimeout(load, 3000);
      } catch {
        // 列表里已经有一份，没网时先用它
      }
    };
    void load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [id, replace]);

  const update = (next: CaptureView) => {
    setCapture(next);
    replace(next);
  };

  return (
    <motion.div className="detail" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, delay: 0.1 }}>
      <motion.div className="detail-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
      <div className="detail-photo">{(original ?? thumb) && <motion.img layoutId={`photo-${id}`} src={original ?? thumb!} alt="" transition={spring} />}</div>
      <div className="statusbar" aria-hidden="true" />
      <button className="float-button back-button" aria-label={copy.common.back} onClick={close}>
        <ChevronLeft />
      </button>
      {capture && <Body capture={capture} onChange={update} />}
    </motion.div>
  );
}

function Body({ capture, onChange }: { capture: CaptureView; onChange: (capture: CaptureView) => void }) {
  if (capture.status === "analyzing")
    return (
      <Paper>
        <Analyzing capture={capture} />
      </Paper>
    );
  if (capture.status === "failed") return <Failed capture={capture} onChange={onChange} />;
  if (!capture.card) return null;
  if (capture.mode === "language") {
    const card = capture.card;
    if (capture.status === "draft") return <Editor capture={capture} card={card} onChange={onChange} />;
    const front = cardText(
      focusText(card),
      card.items.filter((item) => item.selected),
    );
    return (
      <Paper>
        <Preview capture={capture} front={front} back={renderBack(card, capture.question)} lang="de" />
      </Paper>
    );
  }
  if (capture.status === "draft") return <NoteEditor capture={capture} card={capture.card} onChange={onChange} />;
  return (
    <Paper>
      <Preview capture={capture} front={noteFront(capture.card)} back={renderNoteBack(capture.card, capture.question)} />
    </Paper>
  );
}

/** 失败原因：识别不到东西、超时、服务器没 AI，其他照原样显示 */
function failureText(error: string | null) {
  if (error?.startsWith("no_language")) return copy.detail.noLanguage;
  if (error?.startsWith("nothing")) return copy.detail.nothing;
  if (error === "timeout") return copy.detail.timeout;
  if (error === "no_ai") return copy.detail.noAi;
  return error;
}

/** 盖在照片上的“纸” */
function Paper({ children }: { children: ReactNode }) {
  return (
    <motion.div className="paper" initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ ...spring, delay: 0.04 }}>
      {children}
    </motion.div>
  );
}

function Analyzing({ capture }: { capture: CaptureView }) {
  return (
    <div className="state">
      <LoaderCircle className="spin" />
      <p>{copy.detail.analyzing}</p>
      {capture.question && (
        <p className="muted">
          {copy.detail.question}：{capture.question}
        </p>
      )}
    </div>
  );
}

function Failed({ capture, onChange }: { capture: CaptureView; onChange: (capture: CaptureView) => void }) {
  const remove = useStore((state) => state.remove);
  const reason = failureText(capture.error);
  return (
    <>
      <Paper>
        <div className="state failed">
          <p>{reason}</p>
        </div>
      </Paper>
      <div className="actions">
        <button
          className="icon-button danger"
          aria-label={copy.detail.discard}
          onClick={async () => {
            if (!(await ask(copy.detail.discardConfirm, copy.detail.discard, true))) return;
            await api.discard(capture.id);
            remove(capture.id);
          }}
        >
          <Trash2 />
        </button>
        <button className="primary" onClick={async () => onChange(await api.retry(capture.id))}>
          <RotateCcw />
          {copy.detail.retry}
        </button>
      </div>
    </>
  );
}

/** 单词本里的一行：圆圈（要不要学）、词、构词逐段对照、英语、补充 */
function VocabRow({ item, onToggle }: { item: CardItem; onToggle: () => void }) {
  return (
    <div className={`vocab ${item.selected ? "on" : ""}`}>
      <button className="vocab-toggle" role="checkbox" aria-checked={item.selected} aria-label={item.lemma} onClick={onToggle}>
        {item.selected ? <CircleCheck /> : <Circle />}
      </button>
      <div className="vocab-body">
        <div className="vocab-head">
          <span className="vocab-lemma" lang="de">
            {item.lemma}
          </span>
          {item.plural && (
            <span className="vocab-plural" lang="de">
              {item.plural}
            </span>
          )}
          <span className="vocab-kind">{item.kind === "word" ? copy.detail.word : copy.detail.phrase}</span>
        </div>
        <p className="vocab-zh">{item.zh}</p>
        {item.parts && item.parts.length > 1 && <Gloss pairs={item.parts} className="gloss-parts" />}
        {item.en && (
          <p className="vocab-sub">
            <span className="vocab-en-label">{copy.detail.en}</span> <span lang="en">{item.en}</span>
          </p>
        )}
        {item.note && <p className="vocab-sub">{item.note}</p>}
      </div>
    </div>
  );
}

type Busy = "confirm" | "refocus" | "add" | "discard" | null;

/**
 * 服务器返回的卡片内容变了（换句子、补词）才覆盖正在编辑的草稿。
 * 打开详情时会再取一次最新的，内容一样时不能把你已经改了的部分冲掉。
 */
function useServerCard<T>(initial: T, setCard: (card: T) => void) {
  const serialized = JSON.stringify(initial);
  const last = useRef(serialized);
  useEffect(() => {
    if (serialized === last.current) return;
    last.current = serialized;
    setCard(initial);
  }, [serialized, initial, setCard]);
}

/** 上卡的图可以裁剪：照片右上角的按钮、裁剪后的小图、全屏裁剪层 */
function useCardCrop(id: string) {
  const original = useImage(id, "original");
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [cropping, setCropping] = useState(false);
  const [cropped, setCropped] = useState<string | null>(null);
  useEffect(() => {
    if (!crop || !original) return setCropped(null);
    void cropImage(original, crop).then(setCropped);
  }, [crop, original]);
  const controls = (
    <>
      <button className="float-button crop-button" aria-label={copy.detail.crop} onClick={() => setCropping(true)}>
        <CropIcon />
      </button>
      {cropped && <img className="cropped-badge" src={cropped} alt="" />}
      <AnimatePresence>
        {cropping && original && (
          <Crop
            image={original}
            initial={crop}
            onDone={(rect) => {
              setCrop(rect);
              setCropping(false);
            }}
            onCancel={() => setCropping(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
  return { cropped, controls };
}

/** 草稿页的通用部分：忙碌状态、出错提示、确认（做成卡片后停一下再回列表）、丢弃 */
function useDraft(capture: CaptureView, onChange: (capture: CaptureView) => void) {
  const remove = useStore((state) => state.remove);
  const sync = useStore((state) => state.sync);
  const [busy, setBusy] = useState<Busy>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: Busy, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(null);
    }
  };

  const confirm = (card: CardData | NoteCard, cropped: string | null) =>
    run("confirm", async () => {
      const next = await api.confirm(capture.id, card, cropped);
      haptic.success();
      setDone(true);
      // 留一下“已做成卡片”再回到列表；写进 AnkiDroid 在后台进行
      window.setTimeout(() => {
        onChange(next);
        useStore.getState().close();
        void sync();
      }, 700);
    });

  const discard = async () => {
    if (!(await ask(copy.detail.discardConfirm, copy.detail.discard, true))) return;
    void run("discard", async () => {
      await api.discard(capture.id);
      remove(capture.id);
    });
  };

  return { busy, done, error, run, confirm, discard };
}

/** 底部操作栏：丢弃 + 做成卡片 */
function ActionBar({
  busy,
  done,
  error,
  ready,
  idle,
  onDiscard,
  onConfirm,
}: {
  busy: Busy;
  done: boolean;
  error: string | null;
  ready: boolean;
  idle: string;
  onDiscard: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <AnimatePresence>
        {error && (
          <motion.div className="toast danger" role="alert" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}>
            {error}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="actions">
        <button className="icon-button danger" aria-label={copy.detail.discard} disabled={busy !== null} onClick={onDiscard}>
          <Trash2 />
        </button>
        <button className={`primary ${done ? "done" : ""}`} disabled={busy !== null || !ready} onClick={onConfirm}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={done ? "done" : busy === "confirm" ? "busy" : "idle"}
              className="primary-label"
              initial={{ y: 14, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -14, opacity: 0 }}
              transition={{ duration: 0.16 }}
            >
              {done ? (
                <>
                  <Check />
                  {copy.detail.confirmed}
                </>
              ) : busy === "confirm" ? (
                <>
                  <LoaderCircle className="spin" />
                  {copy.detail.working}
                </>
              ) : (
                idle
              )}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    </>
  );
}

function Editor({ capture, card: initial, onChange }: { capture: LanguageCapture; card: CardData; onChange: (capture: CaptureView) => void }) {
  const [card, setCard] = useState(initial);
  const [sheet, setSheet] = useState<"sentences" | "add" | null>(null);
  const { cropped, controls } = useCardCrop(capture.id);
  const { busy, done, error, run, confirm, discard } = useDraft(capture, onChange);

  useServerCard(initial, setCard);

  const toggle = (index: number) => {
    haptic.tap();
    setCard((current) => ({ ...current, items: current.items.map((item, at) => (at === index ? { ...item, selected: !item.selected } : item)) }));
  };
  const selected = card.items.filter((item) => item.selected);

  return (
    <>
      {controls}

      <Paper>
        <p className="de-hero" lang="de" dangerouslySetInnerHTML={{ __html: highlight(focusText(card), selected) }} />
        <p className="translation">{card.translation}</p>

        {capture.question && card.answer && (
          <div className="qa">
            <p className="qa-q">
              {copy.detail.question}：{capture.question}
            </p>
            <p className="qa-a">{card.answer}</p>
          </div>
        )}

        <Section
          title={copy.detail.words}
          aside={
            <button className="text-action" onClick={() => setSheet("add")}>
              <Plus />
              {copy.detail.addWord}
            </button>
          }
        >
          {card.items.map((item, index) => (
            <VocabRow key={`${item.lemma}-${index}`} item={item} onToggle={() => toggle(index)} />
          ))}
        </Section>

        {card.chunks.length > 0 && (
          <Section title={copy.detail.chunks}>
            <Gloss pairs={card.chunks} className="gloss-chunks" />
          </Section>
        )}

        {card.grammar_note && (
          <Section title={copy.detail.grammar}>
            <p className="prose">{card.grammar_note}</p>
          </Section>
        )}

        <button className="row-action" onClick={() => setSheet("sentences")}>
          <Rows3 />
          {copy.detail.sentences(card.focus_ids.length, card.transcript.length)}
        </button>
        {card.unreadable && (
          <p className="hint">
            {copy.detail.unreadable}
            {card.unreadable}
          </p>
        )}
      </Paper>

      <ActionBar
        busy={busy}
        done={done}
        error={error}
        ready={selected.length > 0}
        idle={selected.length > 0 ? copy.detail.confirm : copy.detail.noneSelected}
        onDiscard={() => void discard()}
        onConfirm={() => void confirm(card, cropped)}
      />

      <SentenceSheet
        open={sheet === "sentences"}
        card={card}
        busy={busy === "refocus"}
        onClose={() => setSheet(null)}
        onApply={(ids) =>
          run("refocus", async () => {
            onChange(await api.refocus(capture.id, card, ids));
            setSheet(null);
          })
        }
      />
      <AddWordSheet
        open={sheet === "add"}
        busy={busy === "add"}
        onClose={() => setSheet(null)}
        onAdd={(text) =>
          run("add", async () => {
            onChange(await api.addItem(capture.id, card, text));
            setSheet(null);
          })
        }
      />
    </>
  );
}

function SentenceSheet({ open, card, busy, onClose, onApply }: { open: boolean; card: CardData; busy: boolean; onClose: () => void; onApply: (ids: number[]) => void }) {
  const [ids, setIds] = useState(card.focus_ids);
  useEffect(() => setIds(card.focus_ids), [card.focus_ids, open]);
  const toggle = (sentence: number) => {
    haptic.tap();
    setIds((current) =>
      current.includes(sentence) ? current.filter((value) => value !== sentence) : current.length < MAX_FOCUS ? [...current, sentence].sort((a, b) => a - b) : current,
    );
  };
  const changed = ids.length > 0 && ids.join() !== card.focus_ids.join();
  return (
    <Sheet open={open} onClose={onClose} label={copy.sentences.title}>
      <h2 className="sheet-title">{copy.sentences.title}</h2>
      <p className="hint">{copy.sentences.hint(MAX_FOCUS)}</p>
      <div className="sheet-scroll">
        {card.transcript.map((sentence) => (
          <button key={sentence.id} className={`sentence ${ids.includes(sentence.id) ? "on" : ""}`} aria-pressed={ids.includes(sentence.id)} onClick={() => toggle(sentence.id)}>
            {ids.includes(sentence.id) ? <CircleCheck /> : <Circle />}
            <span lang="de">{sentence.text}</span>
          </button>
        ))}
      </div>
      <button className="primary wide" disabled={!changed || busy} onClick={() => onApply(ids)}>
        {busy ? (
          <>
            <LoaderCircle className="spin" />
            {copy.sentences.working}
          </>
        ) : (
          copy.sentences.apply
        )}
      </button>
    </Sheet>
  );
}

function AddWordSheet({ open, busy, onClose, onAdd }: { open: boolean; busy: boolean; onClose: () => void; onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!open) setText("");
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} label={copy.addWord.title}>
      <h2 className="sheet-title">{copy.addWord.title}</h2>
      <form
        className="sheet-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) onAdd(text.trim());
        }}
      >
        <input className="field" lang="de" autoFocus placeholder={copy.addWord.placeholder} value={text} onChange={(event) => setText(event.target.value)} />
        <button className="primary wide" disabled={!text.trim() || busy}>
          {busy ? (
            <>
              <LoaderCircle className="spin" />
              {copy.addWord.working}
            </>
          ) : (
            copy.addWord.submit
          )}
        </button>
      </form>
    </Sheet>
  );
}

/**
 * 通用做法 / 不用 AI 的草稿：正面、背面直接改。正面里选中一段再点“划重点”，卡上那段会用荧光笔标出。
 */
function NoteEditor({ capture, card: initial, onChange }: { capture: NoteCapture; card: NoteCard; onChange: (capture: CaptureView) => void }) {
  const [card, setCard] = useState(initial);
  const front = useRef<HTMLTextAreaElement>(null);
  const { cropped, controls } = useCardCrop(capture.id);
  const { busy, done, error, confirm, discard } = useDraft(capture, onChange);
  useServerCard(initial, setCard);

  const mark = () => {
    const field = front.current;
    if (!field) return;
    const text = card.front.slice(field.selectionStart, field.selectionEnd).trim();
    if (!text || card.highlights.includes(text)) return;
    haptic.tap();
    setCard({ ...card, highlights: [...card.highlights, text] });
  };
  const unmark = (text: string) => setCard({ ...card, highlights: card.highlights.filter((item) => item !== text) });
  // 正面改掉了的片段不再划
  const highlights = card.highlights.filter((text) => card.front.includes(text));

  return (
    <>
      {controls}
      <Paper>
        <Section
          title={copy.detail.front}
          aside={
            <button className="text-action" onMouseDown={(event) => event.preventDefault()} onClick={mark}>
              <Highlighter />
              {copy.detail.mark}
            </button>
          }
        >
          <textarea
            ref={front}
            className="field note-front"
            rows={3}
            placeholder={copy.detail.frontPlaceholder}
            value={card.front}
            onChange={(event) => setCard({ ...card, front: event.target.value })}
          />
          {highlights.length > 0 && (
            <div className="marks">
              {highlights.map((text) => (
                <button key={text} className="mark-chip" aria-label={text} onClick={() => unmark(text)}>
                  <span>{text}</span>
                  <X />
                </button>
              ))}
            </div>
          )}
        </Section>
        <Section title={copy.detail.back}>
          <textarea
            className="field note-back"
            rows={8}
            placeholder={copy.detail.backPlaceholder}
            value={card.back}
            onChange={(event) => setCard({ ...card, back: event.target.value })}
          />
        </Section>
        {capture.question && card.answer && (
          <div className="qa">
            <p className="qa-q">
              {copy.detail.question}：{capture.question}
            </p>
            <p className="qa-a">{card.answer}</p>
          </div>
        )}
        {card.unreadable && (
          <p className="hint">
            {copy.detail.unreadable}
            {card.unreadable}
          </p>
        )}
      </Paper>
      <ActionBar
        busy={busy}
        done={done}
        error={error}
        ready
        idle={copy.detail.confirm}
        onDiscard={() => void discard()}
        onConfirm={() => void confirm({ ...card, highlights }, cropped)}
      />
    </>
  );
}

/** 已确认：卡片本身，点一下翻面，和 AnkiDroid 里看到的一样（同一套渲染和样式） */
function Preview({ capture, front, back: backHtml, lang }: { capture: CaptureView; front: string; back: string; lang?: string }) {
  const image = useImage(capture.id, "card");
  const config = useStore((state) => state.config);
  const dark = useDark();
  const [back, setBack] = useState(false);
  return (
    <>
      <div className="preview-head">
        <span className={`pill status-${capture.status}`}>
          {capture.status === "in_anki" && <Check />}
          {copy.status[capture.status as keyof typeof copy.status]}
        </span>
        <span className="hint">{copy.preview.flip}</span>
      </div>
      <button className="flip" onClick={() => (haptic.tap(), setBack(!back))} aria-label={back ? copy.preview.back : copy.preview.front}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={back ? "back" : "front"}
            className={`card ${dark ? "nightMode" : ""}`}
            initial={{ rotateY: -90 }}
            animate={{ rotateY: 0 }}
            exit={{ rotateY: 90 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
          >
            {image && (
              <div className="ae-image">
                <img src={image} alt="" />
              </div>
            )}
            {front && <div className="ae-text" lang={lang} dangerouslySetInnerHTML={{ __html: front }} />}
            {back && (
              <>
                <hr id="answer" />
                <div dangerouslySetInnerHTML={{ __html: backHtml }} />
                {config && <div className="ae-source">{localDate(capture.created_at, config.timeZone)}</div>}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </button>
    </>
  );
}
