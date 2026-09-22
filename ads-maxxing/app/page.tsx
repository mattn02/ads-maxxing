import { listSessions } from "@/lib/workflow/sessions";
import { WorkflowConsole } from "@/app/workflow-console";
export const dynamic = "force-dynamic";
export default async function Home() {
  return <WorkflowConsole initialSessions={await listSessions()} />;
}
