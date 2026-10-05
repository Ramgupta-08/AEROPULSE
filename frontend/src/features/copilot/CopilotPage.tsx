import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import { AskTab } from "./AskTab";
import { InsightsTab } from "./InsightsTab";
import { LogEntryTab } from "./LogEntryTab";
import { PartLookupTab } from "./PartLookupTab";

export default function CopilotPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "ask";
  return (
    <>
      <PageHeader title="Technician Copilot" description="Troubleshooting grounded in the manual and fleet logbook, logbook intelligence, voice log entry and QR part lookup." />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList
          className="mb-4"
          tabs={[
            { value: "ask", label: "Assistant" },
            { value: "insights", label: "Logbook intelligence" },
            { value: "log", label: "Log entry" },
            { value: "qr", label: "Part lookup" },
          ]}
        />
        <TabsContent value="ask">
          <AskTab />
        </TabsContent>
        <TabsContent value="insights">
          <InsightsTab />
        </TabsContent>
        <TabsContent value="log">
          <LogEntryTab />
        </TabsContent>
        <TabsContent value="qr">
          <PartLookupTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
