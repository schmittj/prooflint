import { useEffect, useRef, useCallback } from "react";
import { useSettingsStore } from "../stores/settingsStore";

/* ------------------------------------------------------------------ */
/*  Debounce helper                                                    */
/* ------------------------------------------------------------------ */

function useDebouncedSave(key: string, delayMs = 800) {
    const timer = useRef<ReturnType<typeof setTimeout>>();
    const saveField = useSettingsStore((s) => s.saveField);

    const trigger = useCallback(() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => saveField(key), delayMs);
    }, [key, delayMs, saveField]);

    // Clean up on unmount
    useEffect(() => () => clearTimeout(timer.current), []);

    return trigger;
}

/* ------------------------------------------------------------------ */
/*  API key field                                                      */
/* ------------------------------------------------------------------ */

const API_KEY_META: Record<string, { label: string; placeholder: string }> = {
    OPENAI_API_KEY: {
        label: "OpenAI (current bot provider)",
        placeholder: "sk-…",
    },
    ANTHROPIC_API_KEY: {
        label: "Anthropic (planned)",
        placeholder: "sk-ant-…",
    },
    GOOGLE_API_KEY: {
        label: "Google / Gemini (planned)",
        placeholder: "AIza…",
    },
};

function ApiKeyField({ envKey }: { envKey: string }) {
    const serverValue = useSettingsStore((s) => s.serverValues[envKey] ?? "");
    const localEdit = useSettingsStore((s) => s.localEdits[envKey]);
    const isDirty = useSettingsStore((s) => !!s.dirty[envKey]);
    const isSaving = useSettingsStore((s) => !!s.saving[envKey]);
    const isSaved = useSettingsStore((s) => !!s.saved[envKey]);
    const setField = useSettingsStore((s) => s.setField);
    const debouncedSave = useDebouncedSave(envKey);

    const meta = API_KEY_META[envKey];
    const displayValue = isDirty ? (localEdit ?? "") : serverValue;
    const hasKey = isDirty ? (localEdit ?? "").length > 0 : serverValue.length > 0;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setField(envKey, e.target.value);
        debouncedSave();
    };

    const handleFocus = () => {
        // If showing a masked server value, clear so user can paste fresh
        if (!isDirty && serverValue && serverValue.includes("*")) {
            setField(envKey, "");
        }
    };

    const saveField = useSettingsStore((s) => s.saveField);
    const handleBlur = () => saveField(envKey);

    let statusText = "";
    let statusColor = "#888";
    if (isSaving) {
        statusText = "Saving…";
        statusColor = "#666";
    } else if (isSaved) {
        statusText = "Saved";
        statusColor = "#2e7d32";
    } else if (!isDirty && hasKey) {
        statusText = "Configured";
        statusColor = "#2e7d32";
    }

    return (
        <div style={{ marginBottom: 16 }}>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 4,
                }}
            >
                <label
                    htmlFor={envKey}
                    style={{ fontWeight: 500, fontSize: "0.95rem" }}
                >
                    {meta.label}
                </label>
                {statusText && (
                    <span style={{ fontSize: "0.8rem", color: statusColor }}>
                        {statusText}
                    </span>
                )}
            </div>
            <input
                id={envKey}
                type="text"
                value={displayValue}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                placeholder={meta.placeholder}
                autoComplete="off"
                spellCheck={false}
                style={{
                    width: "100%",
                    padding: "8px 10px",
                    fontFamily: "monospace",
                    fontSize: "0.9rem",
                    border: "1px solid #ccc",
                    borderRadius: 4,
                    boxSizing: "border-box",
                }}
            />
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Model defaults section                                             */
/* ------------------------------------------------------------------ */

function ModelDefaults() {
    const serverValues = useSettingsStore((s) => s.serverValues);
    const localEdits = useSettingsStore((s) => s.localEdits);
    const dirty = useSettingsStore((s) => s.dirty);
    const saving = useSettingsStore((s) => s.saving);
    const saved = useSettingsStore((s) => s.saved);
    const setField = useSettingsStore((s) => s.setField);
    const saveField = useSettingsStore((s) => s.saveField);
    const debouncedSaveModel = useDebouncedSave("DEFAULT_MODEL");
    const debouncedSaveEffort = useDebouncedSave("DEFAULT_REASONING_EFFORT");

    const modelValue = dirty["DEFAULT_MODEL"]
        ? (localEdits["DEFAULT_MODEL"] ?? "")
        : (serverValues["DEFAULT_MODEL"] ?? "");
    const effortValue = dirty["DEFAULT_REASONING_EFFORT"]
        ? (localEdits["DEFAULT_REASONING_EFFORT"] ?? "")
        : (serverValues["DEFAULT_REASONING_EFFORT"] ?? "xhigh");

    const modelStatus = saving["DEFAULT_MODEL"]
        ? "Saving…"
        : saved["DEFAULT_MODEL"]
          ? "Saved"
          : "";
    const effortStatus = saving["DEFAULT_REASONING_EFFORT"]
        ? "Saving…"
        : saved["DEFAULT_REASONING_EFFORT"]
          ? "Saved"
          : "";

    return (
        <>
            <div style={{ marginBottom: 16 }}>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 4,
                    }}
                >
                    <label
                        htmlFor="DEFAULT_MODEL"
                        style={{ fontWeight: 500, fontSize: "0.95rem" }}
                    >
                        Default model
                    </label>
                    {modelStatus && (
                        <span
                            style={{
                                fontSize: "0.8rem",
                                color:
                                    modelStatus === "Saved" ? "#2e7d32" : "#666",
                            }}
                        >
                            {modelStatus}
                        </span>
                    )}
                </div>
                <input
                    id="DEFAULT_MODEL"
                    type="text"
                    value={modelValue}
                    onChange={(e) => {
                        setField("DEFAULT_MODEL", e.target.value);
                        debouncedSaveModel();
                    }}
                    onBlur={() => saveField("DEFAULT_MODEL")}
                    placeholder="gpt-5.4-mini"
                    style={{
                        width: "100%",
                        padding: "8px 10px",
                        fontFamily: "monospace",
                        fontSize: "0.9rem",
                        border: "1px solid #ccc",
                        borderRadius: 4,
                        boxSizing: "border-box",
                    }}
                />
            </div>

            <div style={{ marginBottom: 16 }}>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 4,
                    }}
                >
                    <label
                        htmlFor="DEFAULT_REASONING_EFFORT"
                        style={{ fontWeight: 500, fontSize: "0.95rem" }}
                    >
                        Reasoning effort
                    </label>
                    {effortStatus && (
                        <span
                            style={{
                                fontSize: "0.8rem",
                                color:
                                    effortStatus === "Saved" ? "#2e7d32" : "#666",
                            }}
                        >
                            {effortStatus}
                        </span>
                    )}
                </div>
                <select
                    id="DEFAULT_REASONING_EFFORT"
                    value={effortValue}
                    onChange={(e) => {
                        setField("DEFAULT_REASONING_EFFORT", e.target.value);
                        debouncedSaveEffort();
                    }}
                    onBlur={() => saveField("DEFAULT_REASONING_EFFORT")}
                    style={{
                        width: 160,
                        padding: "8px 10px",
                        fontFamily: "monospace",
                        fontSize: "0.9rem",
                        border: "1px solid #ccc",
                        borderRadius: 4,
                    }}
                >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="xhigh">xhigh</option>
                </select>
                <span
                    style={{
                        marginLeft: 8,
                        fontSize: "0.85rem",
                        color: "#888",
                    }}
                >
                    low is the recommended pre-MVP default
                </span>
            </div>
        </>
    );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsPage() {
    const fetchSettings = useSettingsStore((s) => s.fetchSettings);
    const loading = useSettingsStore((s) => s.loading);
    const error = useSettingsStore((s) => s.error);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    if (loading) return <p>Loading settings…</p>;

    return (
        <div style={{ maxWidth: 560 }}>
            <h2 style={{ marginTop: 0, marginBottom: 4 }}>Settings</h2>
            <p style={{ color: "#666", fontSize: "0.9rem", marginTop: 0 }}>
                All data stays on your machine. Changes are saved automatically.
            </p>

            {error && (
                <p
                    style={{
                        color: "#d32f2f",
                        fontSize: "0.9rem",
                        marginTop: 0,
                    }}
                >
                    {error}
                </p>
            )}

            <h3 style={{ marginBottom: 12, marginTop: 28 }}>API Keys</h3>
            <p
                style={{
                    color: "#666",
                    fontSize: "0.85rem",
                    marginTop: 0,
                    marginBottom: 16,
                }}
            >
                Current pre-MVP AI review uses the OpenAI Responses API. You can
                store Anthropic and Gemini keys here for planned integrations, but
                they are not used by the bot yet.
            </p>
            {Object.keys(API_KEY_META).map((key) => (
                <ApiKeyField key={key} envKey={key} />
            ))}

            <h3 style={{ marginBottom: 12, marginTop: 28 }}>Model Defaults</h3>
            <ModelDefaults />
        </div>
    );
}
