export const dynamic = 'force-dynamic';
// Redirect /zoombot ? /bot
import { redirect } from "next/navigation";
export default function ZoomBotRedirect() { redirect("/bot"); }
