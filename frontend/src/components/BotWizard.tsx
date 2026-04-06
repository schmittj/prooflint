import { useState } from "react";
import { useAgentStore } from "../stores/agentStore";
import { useAnnotationStore } from "../stores/annotationStore";
import { useUIStore } from "../stores/uiStore";

interface BotWizardProps {
    docId: string;
    onClose: () => void;
}

const MODELS = [
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
];

const EFFORT_LEVELS = [
    { value: "low", label: "Low", note: "Fast (~1 min)" },
    { value: "medium", label: "Medium", note: "~5 min" },
    { value: "high", label: "High", note: "~15 min" },
    { value: "xhigh", label: "Extra High", note: "30\u201350 min" },
];

export default function BotWizard({ docId, onClose }: BotWizardProps) {
    const { activeBlockIds } = useUIStore();
    const { launchRun } = useAgentStore();
    const annotations = useAnnotationStore((s) => s.annotations);
    const existingAgentAnnotationCount = annotations.filter(
        (annotation) => annotation.source === "agent"
    ).length;

    const [model, setModel] = useState("gpt-5.4-mini");
    const [effort, setEffort] = useState("low");
    const [produceChecks, setProduceChecks] = useState(false);
    const [clearPreviousAgentAnnotations, setClearPreviousAgentAnnotations] =
        useState(existingAgentAnnotationCount > 0);
    const [steeringPrompt, setSteeringPrompt] = useState("");
    const [scopeBlocks, setScopeBlocks] = useState(false);
    const [launching, setLaunching] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleRun = async () => {
        setLaunching(true);
        setError(null);
        try {
            await launchRun(docId, {
                model,
                reasoning_effort: effort,
                steering_prompt: steeringPrompt || undefined,
                options: {
                    produce_checks: produceChecks,
                    clear_previous_agent_annotations:
                        clearPreviousAgentAnnotations,
                },
                block_ids: scopeBlocks ? activeBlockIds : undefined,
            });
            onClose();
        } catch (e: any) {
            setError(
                e?.response?.data?.detail ||
                    e?.message ||
                    "Failed to launch bot"
            );
            setLaunching(false);
        }
    };

    return (
        <div className="bot-wizard-overlay" onClick={onClose}>
            <div
                className="bot-wizard"
                onClick={(e) => e.stopPropagation()}
            >
                <h3 style={{ margin: "0 0 4px" }}>GlobalAnnotatorBot</h3>
                <p
                    style={{
                        margin: "0 0 16px",
                        color: "#666",
                        fontSize: "0.85rem",
                    }}
                >
                    One-pass proof analysis with structured annotations
                </p>

                {/* Scope indicator */}
                {activeBlockIds.length > 0 && (
                    <div
                        style={{
                            padding: "8px 12px",
                            background: "#f0f4ff",
                            borderRadius: 6,
                            marginBottom: 12,
                            fontSize: "0.85rem",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                        }}
                    >
                        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input
                                type="checkbox"
                                checked={scopeBlocks}
                                onChange={(e) =>
                                    setScopeBlocks(e.target.checked)
                                }
                            />
                            Analyze only{" "}
                            {activeBlockIds.length === 1
                                ? `block ${activeBlockIds[0]}`
                                : `blocks ${activeBlockIds[0]}\u2013${activeBlockIds[activeBlockIds.length - 1]}`}
                        </label>
                    </div>
                )}

                {/* Model selector */}
                <div style={{ marginBottom: 12 }}>
                    <label
                        style={{
                            display: "block",
                            fontWeight: 600,
                            fontSize: "0.85rem",
                            marginBottom: 4,
                        }}
                    >
                        Model
                    </label>
                    <select
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        style={{
                            width: "100%",
                            padding: "6px 8px",
                            borderRadius: 4,
                            border: "1px solid #ccc",
                        }}
                    >
                        {MODELS.map((m) => (
                            <option key={m.value} value={m.value}>
                                {m.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Reasoning effort */}
                <div style={{ marginBottom: 12 }}>
                    <label
                        style={{
                            display: "block",
                            fontWeight: 600,
                            fontSize: "0.85rem",
                            marginBottom: 4,
                        }}
                    >
                        Reasoning effort
                    </label>
                    <select
                        value={effort}
                        onChange={(e) => setEffort(e.target.value)}
                        style={{
                            width: "100%",
                            padding: "6px 8px",
                            borderRadius: 4,
                            border: "1px solid #ccc",
                        }}
                    >
                        {EFFORT_LEVELS.map((e) => (
                            <option key={e.value} value={e.value}>
                                {e.label} ({e.note})
                            </option>
                        ))}
                    </select>
                </div>

                {/* Produce checks toggle */}
                <div style={{ marginBottom: 12 }}>
                    <label
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: "0.85rem",
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={produceChecks}
                            onChange={(e) =>
                                setProduceChecks(e.target.checked)
                            }
                        />
                        <span>
                            <strong>Produce checks</strong> &mdash; mark
                            blocks the bot considers sound
                        </span>
                    </label>
                </div>

                {existingAgentAnnotationCount > 0 && (
                    <div style={{ marginBottom: 12 }}>
                        <label
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                fontSize: "0.85rem",
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={clearPreviousAgentAnnotations}
                                onChange={(e) =>
                                    setClearPreviousAgentAnnotations(
                                        e.target.checked
                                    )
                                }
                            />
                            <span>
                                <strong>Clear previous AI annotations</strong>{" "}
                                when this run completes successfully
                            </span>
                        </label>
                        <p
                            style={{
                                margin: "6px 0 0 24px",
                                color: "#666",
                                fontSize: "0.8rem",
                            }}
                        >
                            {existingAgentAnnotationCount} existing AI annotation
                            {existingAgentAnnotationCount === 1 ? "" : "s"} found
                        </p>
                    </div>
                )}

                {/* Steering prompt */}
                <div style={{ marginBottom: 16 }}>
                    <label
                        style={{
                            display: "block",
                            fontWeight: 600,
                            fontSize: "0.85rem",
                            marginBottom: 4,
                        }}
                    >
                        Steering prompt{" "}
                        <span style={{ fontWeight: 400, color: "#888" }}>
                            (optional)
                        </span>
                    </label>
                    <textarea
                        value={steeringPrompt}
                        onChange={(e) => setSteeringPrompt(e.target.value)}
                        placeholder='e.g. "Focus on Lemma 1", "Ignore small typos"'
                        rows={3}
                        style={{
                            width: "100%",
                            padding: "6px 8px",
                            borderRadius: 4,
                            border: "1px solid #ccc",
                            resize: "vertical",
                            fontFamily: "inherit",
                            fontSize: "0.85rem",
                        }}
                    />
                </div>

                {error && (
                    <p
                        style={{
                            color: "#d32f2f",
                            fontSize: "0.85rem",
                            margin: "0 0 12px",
                        }}
                    >
                        {error}
                    </p>
                )}

                {/* Actions */}
                <div
                    style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: 8,
                    }}
                >
                    <button
                        onClick={onClose}
                        style={{
                            padding: "6px 16px",
                            border: "1px solid #ccc",
                            borderRadius: 4,
                            background: "white",
                            cursor: "pointer",
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleRun}
                        disabled={launching}
                        style={{
                            padding: "6px 16px",
                            border: "none",
                            borderRadius: 4,
                            background: launching ? "#999" : "#1976d2",
                            color: "white",
                            cursor: launching ? "default" : "pointer",
                            fontWeight: 600,
                        }}
                    >
                        {launching ? "Launching..." : "Run"}
                    </button>
                </div>
            </div>
        </div>
    );
}
