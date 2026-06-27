import { createFileRoute } from "@tanstack/react-router";
import { RadarConsole } from "@/components/radar/RadarConsole";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return <RadarConsole />;
}
