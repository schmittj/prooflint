import { useEffect, useRef } from "react";
import { useAgentStore } from "../stores/agentStore";
import { useAnnotationStore } from "../stores/annotationStore";

interface BotStatusBarProps {
    docId: string;
}

function formatElapsed(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export default function BotStatusBar({ docId }: BotStatusBarProps) {
    const { activeRun, cancelRun } = useAgentStore();
    const { fetchAnnotations } = useAnnotationStore();
    const refreshedRunId = useRef<string | null>(null);

    // Auto-refresh annotations once when a run completes
    useEffect(() => {
        if (
            activeRun?.status === "completed" &&
            activeRun.id !== refreshedRunId.current
        ) {
            refreshedRunId.current = activeRun.id;
            fetchAnnotations(docId);
        }
    }, [activeRun?.status, activeRun?.id, docId, fetchAnnotations]);

    if (!activeRun) return null;

    const isActive =
        activeRun.status === "pending" || activeRun.status === "running";
    const isCompleted = activeRun.status === "completed";
    const isFailed = activeRun.status === "failed";

    const statusColor = isActive
        ? "#1976d2"
        : isCompleted
          ? "#388e3c"
          : "#d32f2f";

    const elapsed = activeRun.elapsed_seconds;

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px 12px",
                background: "#f5f5f5",
                borderRadius: 6,
                fontSize: "0.8rem",
                marginBottom: 8,
                border: `1px solid ${statusColor}22`,
            }}
        >
            {isActive && (
                <span
                    style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: statusColor,
                        animation: "pulse 1.5s ease-in-out infinite",
                    }}
                />
            )}
            <span style={{ color: statusColor, fontWeight: 600 }}>
                GlobalAnnotatorBot
            </span>
            <span style={{ color: "#666" }}>
                {activeRun.status === "pending" && "starting..."}
                {activeRun.status === "running" &&
                    `running${elapsed ? ` ${formatElapsed(elapsed)}` : "..."}`}
                {activeRun.status === "completed" &&
                    (() => {
                        const chunks = activeRun.chunks?.length ?? 0;
                        return `done \u2014 ${chunks} chunks`;
                    })()}
                {activeRun.status === "failed" &&
                    `failed: ${activeRun.error_message || "unknown error"}`}
            </span>
            <span style={{ flex: 1 }} />
            {isActive && (
                <button
                    onClick={() => cancelRun(docId, activeRun.id)}
                    style={{
                        padding: "2px 8px",
                        border: "1px solid #ccc",
                        borderRadius: 4,
                        background: "white",
                        cursor: "pointer",
                        fontSize: "0.75rem",
                    }}
                >
                    Cancel
                </button>
            )}
            {(isCompleted || isFailed) && (
                <button
                    onClick={() => useAgentStore.getState().clearActive()}
                    style={{
                        padding: "2px 8px",
                        border: "1px solid #ccc",
                        borderRadius: 4,
                        background: "white",
                        cursor: "pointer",
                        fontSize: "0.75rem",
                    }}
                >
                    Dismiss
                </button>
            )}
        </div>
    );
}
