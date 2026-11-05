import type { Metadata } from "next";
import "../landing.css";
import SiteHeader from "../components/landing/SiteHeader";
import SiteFooter from "../components/landing/SiteFooter";

export const metadata: Metadata = { title: "Privacy - ClarityMeet" };

// Placeholder support address for now (not a real inbox yet).
const CONTACT_EMAIL = "claritymeet@help.com";

export default function PrivacyPage() {
  return (
    <div className="lp">
      <SiteHeader showSectionLinks={false} />
      <main id="main" className="lp-wrap">
        <article className="lp-doc">
          <h1>Privacy</h1>
          <p>Last updated 22 October 2026</p>

          <h2>What we collect</h2>
          <ul>
            <li>Your account details: name, email address and, if you sign in with Google, your profile picture.</li>
            <li>Meetings you choose to record or upload: the audio, the transcript, the summary, highlights and tasks made from it, and the names of the people who spoke.</li>
            <li>Workspace information: workspace names, members and their roles, invites, and any calendar feed links you add.</li>
          </ul>

          <h2>How meetings are processed</h2>
          <p>
            When you start ClarityMeet, the meeting is recorded on the computer running the ClarityMeet service.
            The recording is sent to Google&apos;s Gemini AI model to create the transcript, summary and tasks.
            The recording and the results are stored with our database provider, Supabase, and are visible to members of the workspace the meeting belongs to.
          </p>

          <h2>Recording consent</h2>
          <p>
            ClarityMeet always joins under the name &ldquo;ClarityMeet&rdquo; so others can see it. You are responsible for telling
            participants that the meeting is being recorded and for following the recording laws that apply to you and them.
          </p>

          <h2>Who we share data with</h2>
          <p>Only the services needed to run ClarityMeet: Supabase (accounts and storage), Google Gemini (transcription and summaries) and your email provider for invite and account emails. We don&apos;t sell your data.</p>

          <h2>Deleting your data</h2>
          <p>Workspace admins can delete meetings and tasks at any time. To delete your account and everything in it, contact us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>

          <h2>Contact</h2>
          <p>Questions about privacy: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
