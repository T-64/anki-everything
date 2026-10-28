import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { PenLine, ScanText } from "lucide-react";
import { copy } from "../i18n";
import { lastMode, useStore } from "../store";
import { Sheet, haptic } from "../ui";
import { MODES, type Mode } from "../../shared/capture";

/** 拍完照：选做法（语言 / 通用 / 不用 AI），可选地写一句“哪里看不懂” */
export function AskSheet() {
  const asking = useStore((state) => state.asking);
  const ai = useStore((state) => state.config?.ai ?? true);
  const submit = useStore((state) => state.submit);
  const cancel = useStore((state) => state.cancelAsk);
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<Mode>(lastMode);
  // 服务器没有 AI 时只有“不用 AI”
  const effective: Mode = ai ? mode : "manual";
  useEffect(() => {
    if (asking) setMode(lastMode());
  }, [asking]);

  const start = () => {
    void submit(effective, question.trim() || null);
    setQuestion("");
  };
  return (
    <Sheet open={asking !== null} onClose={() => (cancel(), setQuestion(""))} label={copy.ask.title}>
      {asking && <img className="ask-photo" src={asking} alt="" />}
      {ai && (
        <nav className="filters mode-picker">
          {MODES.map((key) => (
            <button key={key} className={`filter ${effective === key ? "on" : ""}`} aria-pressed={effective === key} onClick={() => (haptic.tap(), setMode(key))}>
              {effective === key && <motion.span layoutId="mode-pill" className="filter-pill" transition={{ type: "spring", damping: 30, stiffness: 400 }} />}
              <span className="filter-label">{copy.modes[key]}</span>
            </button>
          ))}
        </nav>
      )}
      {effective !== "manual" && (
        <>
          <label className="sheet-title" htmlFor="question">
            {copy.ask.title}
          </label>
          <textarea id="question" className="field" rows={2} placeholder={copy.ask.placeholder} value={question} onChange={(event) => setQuestion(event.target.value)} />
        </>
      )}
      <button className="primary wide" onClick={start}>
        {effective === "manual" ? <PenLine /> : <ScanText />}
        {effective === "manual" ? copy.ask.manualSubmit : copy.ask.submit}
      </button>
    </Sheet>
  );
}
