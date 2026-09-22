import { listSessions, loadSession } from "@/lib/workflow/sessions";
import { WorkflowConsole } from "@/app/workflow-console";
export const dynamic = "force-dynamic";
export default async function Home() {
  const sessions = await listSessions();
  return (
    <WorkflowConsole
      initialSessions={sessions}
      initialSession={sessions[0] ? await loadSession(sessions[0].id) : null}
    />
  );
}
