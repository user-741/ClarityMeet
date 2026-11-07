"use client";

// "How it works" scroll story.

import { useEffect, useRef, useState } from "react";
import { PasteLinkVisual, JoinedVisual, SummaryVisual, TasksVisual } from "./Illustrations";

const STEPS = [
  {
    title: "Paste the meeting link",
    body: "Copy the Zoom or Teams invite into ClarityMeet from whatever device you're on - your phone, a laptop, anywhere you're signed in.",
    Visual: PasteLinkVisual,
  },
  {
    title: "ClarityMeet joins for you",
    body: "ClarityMeet opens the meeting in Zoom or Teams and joins as a named guest. There's no Join button to press, and everyone in the call can see it's there.",
    Visual: JoinedVisual,
  },
  {
    title: "The summary writes itself",
    body: "When the meeting ends, recording stops on its own. The audio is transcribed and summarised, with people named when they introduce themselves.",
    Visual: SummaryVisual,
  },
  {
    title: "Tasks land with owners",
    body: "Action items appear in Tasks with who said they'd do it and how urgent it is - ready to tick off, sort or export.",
    Visual: TasksVisual,
  },
];

export default function HowItWorks() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    refs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="lp-how-grid">
      <ol className="lp-steps">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            ref={(el) => { refs.current[i] = el; }}
            data-index={i}
            className={`lp-step${i === active ? " is-active" : ""}`}
            aria-current={i === active ? "step" : undefined}
          >
            <span className="lp-step-num" aria-label={`Step ${i + 1} of ${STEPS.length}`}>{i + 1}</span>
            <h3 className="lp-h2" style={{ fontSize: "clamp(24px, 2.6vw, 32px)" }}>{s.title}</h3>
            <p className="lp-p" style={{ fontSize: 16, maxWidth: "46ch" }}>{s.body}</p>
            <div className="lp-step-visual"><s.Visual /></div>
          </li>
        ))}
      </ol>

      <div className="lp-stage" aria-hidden="true">
        <div className="lp-progress">
          {STEPS.map((s, i) => <span key={s.title} className={i <= active ? "is-done" : ""} />)}
        </div>
        <div style={{ position: "relative", height: "100%" }}>
          {STEPS.map((s, i) => (
            <div key={s.title} className={`lp-stage-item${i === active ? " is-active" : ""}`}>
              <s.Visual />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
