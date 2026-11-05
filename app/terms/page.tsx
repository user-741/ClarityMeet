import type { Metadata } from "next";
import "../landing.css";
import SiteHeader from "../components/landing/SiteHeader";
import SiteFooter from "../components/landing/SiteFooter";

export const metadata: Metadata = { title: "Terms - ClarityMeet" };

// Placeholder support address for now (not a real inbox yet).
const CONTACT_EMAIL = "claritymeet@help.com";

export default function TermsPage() {
  return (
    <div className="lp">
      <SiteHeader showSectionLinks={false} />
      <main id="main" className="lp-wrap">
        <article className="lp-doc">
          <h1>Terms of use</h1>
          <p>Last updated 22 October 2026</p>

          <h2>Using ClarityMeet</h2>
          <p>ClarityMeet records meetings you send it to and turns them into transcripts, summaries and tasks. You need an account to use it, and you&apos;re responsible for what happens under your account.</p>

          <h2>Recording other people</h2>
          <p>Only record meetings you&apos;re allowed to record. Tell participants before recording and follow the laws that apply where you and they are. Don&apos;t use ClarityMeet to record people secretly.</p>

          <h2>Your content</h2>
          <p>Recordings, transcripts and tasks belong to you and your workspace. You give us permission to store and process them only so we can provide the service.</p>

          <h2>AI-generated results</h2>
          <p>Transcripts, summaries and tasks are produced by an AI model and can contain mistakes, including misheard names or missed details. Check anything important before relying on it.</p>

          <h2>Availability</h2>
          <p>ClarityMeet is provided as is. We work to keep it running but can&apos;t promise it will always be available or error-free.</p>

          <h2>Contact</h2>
          <p>Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
