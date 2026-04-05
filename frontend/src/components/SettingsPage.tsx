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
    ANTHROPIC_API_KEY: {
        label: "Anthropic (Claude)",
        placeholder: "sk-ant-…",
    },
    OPENAI_API_KEY: {
        label: "OpenAI (GPT)",
        placeholder: "sk-…",
    },
    GOOGLE_API_KEY: {
        label: "Google (Gemini)",
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
    const debouncedSaveTemp = useDebouncedSave("DEFAULT_TEMPERATURE");

    const modelValue = dirty["DEFAULT_MODEL"]
        ? (localEdits["DEFAULT_MODEL"] ?? "")
        : (serverValues["DEFAULT_MODEL"] ?? "");
    const tempValue = dirty["DEFAULT_TEMPERATURE"]
        ? (localEdits["DEFAULT_TEMPERATURE"] ?? "")
        : (serverValues["DEFAULT_TEMPERATURE"] ?? "");

    const modelStatus = saving["DEFAULT_MODEL"]
        ? "Saving…"
        : saved["DEFAULT_MODEL"]
          ? "Saved"
          : "";
    const tempStatus = saving["DEFAULT_TEMPERATURE"]
        ? "Saving…"
        : saved["DEFAULT_TEMPERATURE"]
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
                    placeholder="claude-sonnet-4-6"
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
                        htmlFor="DEFAULT_TEMPERATURE"
                        style={{ fontWeight: 500, fontSize: "0.95rem" }}
                    >
                        Temperature
                    </label>
                    {tempStatus && (
                        <span
                            style={{
                                fontSize: "0.8rem",
                                color:
                                    tempStatus === "Saved" ? "#2e7d32" : "#666",
                            }}
                        >
                            {tempStatus}
                        </span>
                    )}
                </div>
                <input
                    id="DEFAULT_TEMPERATURE"
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={tempValue}
                    onChange={(e) => {
                        setField("DEFAULT_TEMPERATURE", e.target.value);
                        debouncedSaveTemp();
                    }}
                    onBlur={() => saveField("DEFAULT_TEMPERATURE")}
                    style={{
                        width: 120,
                        padding: "8px 10px",
                        fontFamily: "monospace",
                        fontSize: "0.9rem",
                        border: "1px solid #ccc",
                        borderRadius: 4,
                    }}
                />
                <span
                    style={{
                        marginLeft: 8,
                        fontSize: "0.85rem",
                        color: "#888",
                    }}
                >
                    0 = deterministic, 2 = most creative
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

            <h3 style={{ marginBottom: 12, marginTop: 28 }}>API Keys</h3>
            <p
                style={{
                    color: "#666",
                    fontSize: "0.85rem",
                    marginTop: 0,
                    marginBottom: 16,
                }}
            >
                Add at least one key to enable AI review features. You can also
                edit the <code>.env</code> file directly.
            </p>
            {Object.keys(API_KEY_META).map((key) => (
                <ApiKeyField key={key} envKey={key} />
            ))}

            <h3 style={{ marginBottom: 12, marginTop: 28 }}>Model Defaults</h3>
            <ModelDefaults />
        </div>
    );
}
