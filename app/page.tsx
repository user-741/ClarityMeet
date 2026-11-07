// Public landing page, shown at "/".

import { Mic, Sparkles, SquareCheck, BarChart3, Link2, ScrollText, Upload, Users, CalendarDays, Download, Video, MonitorPlay, ChevronDown } from "lucide-react";
import "./landing.css";
import SiteHeader from "./components/landing/SiteHeader";
import SiteFooter from "./components/landing/SiteFooter";
import HowItWorks from "./components/landing/HowItWorks";
import HeroCta from "./components/landing/HeroCta";
import { DashboardPreview, CallMock } from "./components/landing/Illustrations";

const HERO_POINTS = [
  { icon: Mic, label: "Auto-transcription", tone: "purple" },
  { icon: Sparkles, label: "AI Summaries", tone: "blue" },
  { icon: SquareCheck, label: "Task Extraction", tone: "green" },
  { icon: BarChart3, label: "Team Analytics", tone: "purple" },
];

const FEATURES = [
  { icon: Mic, tone: "purple", title: "Joins your meetings", body: "Joins your Zoom and Teams calls on its own, records them, and stops when the meeting ends." },
  { icon: Sparkles, tone: "blue", title: "AI task extraction", body: "Finds action items, decisions and owners in the conversation - no manual note-taking." },
  { icon: BarChart3, tone: "green", title: "Team analytics", body: "See completion rates, tasks per meeting and how your team is tracking over time." },
  { icon: Link2, tone: "purple", title: "Integrations", body: "Works with Zoom, Microsoft Teams and Google Meet, plus your Google, Outlook or iCloud calendar." },
];

const MORE = [
  { icon: ScrollText, label: "Full transcripts" },
  { icon: Upload, label: "Upload past recordings" },
  { icon: Users, label: "Shared workspaces & roles" },
  { icon: CalendarDays, label: "Calendar sync" },
  { icon: Download, label: "Export to CSV or TXT" },
];

const PLATFORMS = [
  { icon: Video, name: "Zoom", body: "Joins automatically in the Zoom desktop app.", tone: "blue" },
  { icon: Users, name: "Microsoft Teams", body: "Joins automatically in the Teams desktop app.", tone: "purple" },
  { icon: MonitorPlay, name: "Google Meet", body: "Opens in the browser - one click to join.", tone: "green" },
];

const FAQ = [
  { q: "Do other people in the meeting know it's being recorded?", a: "Yes. ClarityMeet joins under its own name and shows up in the participant list like any other guest. Let people know before you record, and follow the recording rules where you are." },
  { q: "Where is the audio processed?", a: "The meeting is recorded on the computer running the ClarityMeet service, then sent to Google's Gemini model to be transcribed and summarised. The recording, transcript and results are stored in your workspace." },
  { q: "What if the meeting has a waiting room?", a: "The host needs to let ClarityMeet in, the same as any other guest." },
  { q: "Can I use it for meetings that already happened?", a: "Yes. Upload the recording on the Upload page and you'll get the same summary, highlights and tasks." },
  { q: "Does it get people's names right?", a: "It uses the names of the people in your workspace, so teammates are spelled correctly and tasks are linked to them. Guests are named when they introduce themselves." },
];

export default function HomePage() {
  return (
    <div className="lp">
      <SiteHeader />

      <main id="main">
        {/* Hero */}
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-grid">
            <div>
              <p className="lp-pill">Works with Zoom · Teams · Google Meet</p>
              <h1 className="lp-h1">Meetings that actually turn into results</h1>
              <p className="lp-lead">
                ClarityMeet joins your calls, transcribes every word, and automatically extracts action items - so nothing falls through the cracks again.
              </p>
              <HeroCta />
              <div className="lp-hero-icons">
                {HERO_POINTS.map(p => (
                  <div key={p.label}>
                    <span className={`lp-ic lp-ic-${p.tone}`}><p.icon size={20} aria-hidden="true" /></span>
                    {p.label}
                  </div>
                ))}
              </div>
            </div>
            <div className="lp-hero-visual">
              <div className="lp-blob" aria-hidden="true" />
              <span className="lp-preview-tag">Preview · example data</span>
              <DashboardPreview />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="lp-section lp-section-alt" id="how" aria-labelledby="how-title">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <p className="lp-eyebrow">How it works</p>
              <h2 className="lp-h2" id="how-title">From invite to action items, without taking notes</h2>
              <p className="lp-p">Scroll through what happens from the moment you paste a link.</p>
            </div>
            <HowItWorks />
          </div>
        </section>

        {/* Features */}
        <section className="lp-section" id="features" aria-labelledby="features-title">
          <div className="lp-wrap">
            <div className="lp-section-head lp-center" style={{ textAlign: "center" }}>
              <h2 className="lp-h2" id="features-title">Everything your team needs</h2>
              <p className="lp-p" style={{ fontSize: 18 }}>From the moment a meeting starts to the final task being completed.</p>
            </div>
            <div className="lp-features">
              {FEATURES.map(f => (
                <div key={f.title} className="lp-feature">
                  <span className={`lp-ic lp-ic-lg lp-ic-${f.tone}`}><f.icon size={26} aria-hidden="true" /></span>
                  <h3 className="lp-h3">{f.title}</h3>
                  <p className="lp-p">{f.body}</p>
                </div>
              ))}
            </div>
            <div className="lp-more" aria-label="Also included">
              {MORE.map(m => <span key={m.label} className="lp-chip"><m.icon size={14} aria-hidden="true" />{m.label}</span>)}
            </div>
          </div>
        </section>

        {/* Platforms */}
        <section className="lp-section lp-section-alt" aria-labelledby="platforms-title">
          <div className="lp-wrap">
            <div className="lp-section-head">
              <p className="lp-eyebrow">Platforms</p>
              <h2 className="lp-h2" id="platforms-title">Works where your meetings already happen</h2>
            </div>
            <div className="lp-platforms">
              {PLATFORMS.map(p => (
                <div key={p.name} className="lp-platform">
                  <span className={`lp-ic lp-ic-${p.tone}`}><p.icon size={20} aria-hidden="true" /></span>
                  <div>
                    <p className="lp-platform-name">{p.name}</p>
                    <p className="lp-p">{p.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="lp-section" id="faq" aria-labelledby="faq-title">
          <div className="lp-wrap">
            <div className="lp-section-head" style={{ textAlign: "center", marginLeft: "auto", marginRight: "auto" }}>
              <h2 className="lp-h2" id="faq-title">Questions, answered</h2>
            </div>
            <div className="lp-faq">
              {FAQ.map(item => (
                <details key={item.q}>
                  <summary>{item.q}<ChevronDown size={18} aria-hidden="true" /></summary>
                  <p className="lp-p">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA band */}
        <section className="lp-section" style={{ paddingTop: 0 }} aria-labelledby="final-title">
          <div className="lp-wrap">
            <div className="lp-cta-band">
              <div>
                <h2 className="lp-h2" id="final-title">Ready to stop losing action items?</h2>
                <p className="lp-lead">Create a workspace in a minute and let ClarityMeet take care of your next call.</p>
                <HeroCta label="Get started - it's free" showSecondary={false} />
              </div>
              <CallMock />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
