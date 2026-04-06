import { useState } from "react";
import { useAgentStore } from "../stores/agentStore";
import { useUIStore } from "../stores/uiStore";

export default function BotSummary() {
    const { runs, activeRun } = useAgentStore();
    const bumpLayout = useUIStore((s) => s.bumpLayout);
    const [expanded, setExpanded] = useState(false);

    const toggle = () => {
        setExpanded(!expanded);
        // Schedule layout recalc after the DOM updates
        requestAnimationFrame(() => bumpLayout());
    };

    // Find the most recent completed run (either activeRun or from history)
    const completedRun =
        activeRun?.status === "completed"
            ? activeRun
            : runs.find((r) => r.status === "completed");

    const isRunning =
        activeRun?.status === "pending" || activeRun?.status === "running";

    // No runs at all
    if (!completedRun && !isRunning) {
        return (
            <div
                style={{
                    padding: "8px 12px",
                    background: "#f9f9f9",
                    borderRadius: 6,
                    fontSize: "0.85rem",
                    color: "#888",
                    marginBottom: 12,
                }}
            >
                No bot summary available yet. Click <strong>Run Bot</strong> to
                get an AI analysis of this document.
            </div>
        );
    }

    // Running but no completed run yet
    if (!completedRun) return null;

    const confidence = completedRun.overall_confidence;

    return (
        <div
            style={{
                borderRadius: 6,
                border: "1px solid #d0d7e0",
                marginBottom: 12,
                overflow: "hidden",
            }}
        >
            <button
                onClick={toggle}
                style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 12px",
                    background: "#f0f4ff",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    color: "#333",
                    textAlign: "left",
                }}
            >
                <span style={{ color: "#5b9bd5", fontSize: "0.75rem" }}>
                    {expanded ? "\u25bc" : "\u25b6"}
                </span>
                Bot Summary
                {confidence != null && (
                    <span
                        style={{
                            fontWeight: 400,
                            color: "#888",
                            fontSize: "0.8rem",
                        }}
                    >
                        (confidence: {(confidence * 100).toFixed(0)}%)
                    </span>
                )}
            </button>
            {expanded && (
                <div
                    style={{
                        padding: "10px 12px",
                        fontSize: "0.85rem",
                        lineHeight: 1.55,
                        background: "white",
                        whiteSpace: "pre-wrap",
                    }}
                >
                    {completedRun.summary || "No summary was produced."}
                </div>
            )}
        </div>
    );
}
