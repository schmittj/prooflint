import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeMathjax from "rehype-mathjax";
import type { Annotation } from "../types/models";
import { useAnnotationStore } from "../stores/annotationStore";
import { useUIStore } from "../stores/uiStore";

/* ── Constants ── */
const CARD_GAP = 8;
const EST_CARD_H = 88;
const CURVE_INDENT = 28;

const SEV = {
    info: { bg: "#eef4ff", border: "#b0c9f0", dot: "#5b9bd5" },
    warning: { bg: "#fff8e6", border: "#e6c84a", dot: "#d4a017" },
    error: { bg: "#fff0f0", border: "#e68a8a", dot: "#d44" },
} as const;

const CHECKED_CARD = { bg: "#e6f4ea", border: "#6abf69", dot: "#2e7d32" };

function cardColors(ann: { annotation_type: string; severity: string }) {
    if (ann.annotation_type === "checked") return CHECKED_CARD;
    return SEV[ann.severity as keyof typeof SEV] ?? SEV.info;
}

const ANN_TYPES = [
    { value: "gap", label: "Logical gap" },
    { value: "error", label: "Potential error" },
    { value: "handwave", label: "Handwaving" },
    { value: "unclear", label: "Unclear" },
    { value: "assumption", label: "Unverified assumption" },
    { value: "info", label: "Informational note" },
    { value: "comment", label: "Comment" },
    { value: "checked", label: "Checked / verified" },
    { value: "needs_review", label: "Needs review" },
    { value: "logic_mistake", label: "Logic mistake" },
];

/* ── Layout: position annotation groups near their block Y ── */
interface LayoutGroup {
    blockId: string;
    targetY: number;
    height: number; // estimated total height of this group
}

function resolvePositions(
    groups: LayoutGroup[],
    activeBlockId: string | null
): Map<string, number> {
    if (groups.length === 0) return new Map();
    const sorted = [...groups].sort((a, b) => a.targetY - b.targetY);
    const result = new Map<string, number>();

    const activeIdx =
        activeBlockId != null
            ? sorted.findIndex((g) => g.blockId === activeBlockId)
            : -1;

    if (activeIdx >= 0) {
        // Active group sits exactly at its target
        const active = sorted[activeIdx];
        result.set(active.blockId, active.targetY);

        // Above active: pack upward
        let ceiling = active.targetY;
        for (let i = activeIdx - 1; i >= 0; i--) {
            const g = sorted[i];
            const y = Math.max(0, Math.min(g.targetY, ceiling - g.height - CARD_GAP));
            result.set(g.blockId, y);
            ceiling = y;
        }

        // Below active: pack downward
        let floor = active.targetY + active.height + CARD_GAP;
        for (let i = activeIdx + 1; i < sorted.length; i++) {
            const g = sorted[i];
            const y = Math.max(g.targetY, floor);
            result.set(g.blockId, y);
            floor = y + g.height + CARD_GAP;
        }
    } else {
        // No active: greedy top-down
        let minY = 0;
        for (const g of sorted) {
            const y = Math.max(g.targetY, minY);
            result.set(g.blockId, y);
            minY = y + g.height + CARD_GAP;
        }
    }

    return result;
}

/* ── S-curve SVG path ── */
function sCurve(blockY: number, cardY: number): string {
    const x0 = 4,
        y0 = blockY + 14;
    const x1 = CURVE_INDENT,
        y1 = cardY + 14;
    const mx = CURVE_INDENT / 2;
    return `M ${x0},${y0} C ${mx},${y0} ${mx},${y1} ${x1},${y1}`;
}

/* ── Inline Markdown renderer (reuse remark/rehype plugins) ── */
function AnnotationMessage({ text }: { text: string }) {
    return (
        <Markdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[rehypeMathjax]}
            components={{ p: ({ children }) => <span>{children}</span> }}
        >
            {text}
        </Markdown>
    );
}

/* ── Editable message: click to edit, blur/Enter to save ── */
function EditableMessage({
    annotation,
    docId,
}: {
    annotation: Annotation;
    docId: string;
}) {
    const { updateAnnotation } = useAnnotationStore();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(annotation.message);

    const save = async () => {
        const trimmed = draft.trim();
        if (trimmed && trimmed !== annotation.message) {
            await updateAnnotation(docId, annotation.id, { message: trimmed });
        }
        setEditing(false);
    };

    if (editing) {
        return (
            <textarea
                className="annotation-edit-textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={save}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        save();
                    }
                    if (e.key === "Escape") {
                        setDraft(annotation.message);
                        setEditing(false);
                    }
                }}
                rows={2}
                autoFocus
            />
        );
    }

    return (
        <div
            className="annotation-card-message annotation-card-message-clickable"
            onClick={(e) => {
                e.stopPropagation();
                setDraft(annotation.message);
                setEditing(true);
            }}
            title="Click to edit"
        >
            <AnnotationMessage text={annotation.message} />
        </div>
    );
}

/* ── Main component ── */
interface Props {
    readerRef: React.RefObject<HTMLElement | null>;
}

export default function AnnotationPanel({ readerRef }: Props) {
    const { id: docId } = useParams<{ id: string }>();
    const { annotations, createAnnotation, updateAnnotation, deleteAnnotation } =
        useAnnotationStore();
    const { activeBlockId } = useUIStore();
    const panelRef = useRef<HTMLDivElement>(null);

    // Block Y positions (relative to reader scroll-content top)
    const [blockYMap, setBlockYMap] = useState<Map<string, number>>(new Map());
    const [contentHeight, setContentHeight] = useState(1000);

    // Hide-checked toggle
    const [hideChecked, setHideChecked] = useState(false);

    // Form state
    const [addingForBlock, setAddingForBlock] = useState<string | null>(null);
    const [formType, setFormType] = useState("gap");
    const [formSev, setFormSev] = useState<"info" | "warning" | "error">("warning");
    const [formMsg, setFormMsg] = useState("");
    const [saving, setSaving] = useState(false);

    // Measure block positions from the reader DOM
    const measureBlocks = useCallback(() => {
        const reader = readerRef.current;
        if (!reader) return;
        setContentHeight(reader.scrollHeight);
        const rTop = reader.getBoundingClientRect().top - reader.scrollTop;
        const map = new Map<string, number>();
        reader.querySelectorAll<HTMLElement>("[data-block-id]").forEach((el) => {
            map.set(el.dataset.blockId!, el.getBoundingClientRect().top - rTop);
        });
        setBlockYMap(map);
    }, [readerRef]);

    // Scroll-sync panel with reader + re-measure on scroll/resize
    useEffect(() => {
        const reader = readerRef.current;
        const panel = panelRef.current;
        if (!reader || !panel) return;

        const sync = () => {
            panel.scrollTop = reader.scrollTop;
            measureBlocks();
        };

        // Prevent independent scrolling of the panel
        const preventScroll = (e: WheelEvent) => {
            e.preventDefault();
            reader.scrollTop += e.deltaY;
        };

        measureBlocks();
        reader.addEventListener("scroll", sync, { passive: true });
        panel.addEventListener("wheel", preventScroll, { passive: false });
        window.addEventListener("resize", measureBlocks);
        const ro = new ResizeObserver(measureBlocks);
        ro.observe(reader);

        return () => {
            reader.removeEventListener("scroll", sync);
            panel.removeEventListener("wheel", preventScroll);
            window.removeEventListener("resize", measureBlocks);
            ro.disconnect();
        };
    }, [readerRef, measureBlocks]);

    // Reset add-form when selection changes
    useEffect(() => {
        setAddingForBlock(null);
    }, [activeBlockId]);

    // Group annotations by block_id, applying hideChecked filter
    const grouped = useMemo(() => {
        const map = new Map<string, Annotation[]>();
        for (const a of annotations) {
            // If hideChecked, skip checked annotations (unless on the active block)
            if (
                hideChecked &&
                a.annotation_type === "checked" &&
                a.block_id !== activeBlockId
            ) {
                continue;
            }
            const arr = map.get(a.block_id) ?? [];
            arr.push(a);
            map.set(a.block_id, arr);
        }
        return map;
    }, [annotations, hideChecked, activeBlockId]);

    // All block IDs that need a slot (have annotations, or are selected)
    const slotBlockIds = useMemo(() => {
        const ids = new Set(grouped.keys());
        if (activeBlockId) ids.add(activeBlockId);
        return ids;
    }, [grouped, activeBlockId]);

    // Build layout
    const layoutGroups = useMemo(
        () =>
            Array.from(slotBlockIds).map((blockId) => {
                const anns = grouped.get(blockId) ?? [];
                let items = anns.length;
                if (blockId === activeBlockId) {
                    items += addingForBlock === blockId ? 3 : 1; // form ≈ 3 cards
                }
                return {
                    blockId,
                    targetY: blockYMap.get(blockId) ?? 0,
                    height: Math.max(items, 1) * EST_CARD_H,
                };
            }),
        [slotBlockIds, grouped, activeBlockId, addingForBlock, blockYMap]
    );

    const positions = useMemo(
        () => resolvePositions(layoutGroups, activeBlockId),
        [layoutGroups, activeBlockId]
    );

    // Panel inner height: at least reader height, or enough for the last card
    const panelHeight = useMemo(() => {
        let max = contentHeight;
        for (const [blockId, y] of positions) {
            const g = layoutGroups.find((g) => g.blockId === blockId);
            if (g) max = Math.max(max, y + g.height + 40);
        }
        return max;
    }, [positions, layoutGroups, contentHeight]);

    // Handlers
    const handleCreate = async () => {
        if (!docId || !addingForBlock || !formMsg.trim()) return;
        setSaving(true);
        try {
            await createAnnotation(docId, {
                block_id: addingForBlock,
                annotation_type: formType,
                severity: formSev,
                message: formMsg.trim(),
            });
            setFormMsg("");
            setAddingForBlock(null);
        } catch (err: unknown) {
            const axErr = err as { response?: { data?: unknown } };
            console.error("Create failed:", axErr.response?.data ?? err);
            alert(
                `Save failed: ${JSON.stringify(axErr.response?.data ?? "unknown")}`
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            ref={panelRef}
            className="annotation-panel-scroll"
        >
            {/* Hide Checked toggle */}
            <div className="annotation-panel-toolbar">
                <label className="hide-checked-toggle">
                    <input
                        type="checkbox"
                        checked={hideChecked}
                        onChange={() => setHideChecked(!hideChecked)}
                    />
                    Hide checked
                </label>
            </div>

            <div
                style={{
                    position: "relative",
                    minHeight: panelHeight,
                    paddingLeft: CURVE_INDENT + 4,
                }}
            >
                {/* SVG connector lines */}
                <svg
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: CURVE_INDENT,
                        height: panelHeight,
                        pointerEvents: "none",
                    }}
                >
                    {Array.from(slotBlockIds).map((blockId) => {
                        const blockY = blockYMap.get(blockId);
                        const cardY = positions.get(blockId);
                        if (blockY == null || cardY == null) return null;
                        const anns = grouped.get(blockId) ?? [];
                        if (anns.length === 0 && blockId !== activeBlockId)
                            return null;
                        const isActive = blockId === activeBlockId;
                        return (
                            <g key={blockId}>
                                <circle
                                    cx={4}
                                    cy={blockY + 14}
                                    r={3}
                                    fill={isActive ? "#4a6fa5" : "#ccc"}
                                />
                                <path
                                    d={sCurve(blockY, cardY)}
                                    fill="none"
                                    stroke={isActive ? "#4a6fa5" : "#ddd"}
                                    strokeWidth={isActive ? 1.5 : 1}
                                />
                            </g>
                        );
                    })}
                </svg>

                {/* Positioned annotation groups */}
                {Array.from(slotBlockIds).map((blockId) => {
                    const y = positions.get(blockId) ?? 0;
                    const anns = grouped.get(blockId) ?? [];
                    const isActive = blockId === activeBlockId;

                    return (
                        <div
                            key={blockId}
                            className="annotation-group"
                            style={{
                                position: "absolute",
                                top: y,
                                left: CURVE_INDENT + 4,
                                right: 0,
                                transition: "top 0.25s ease-out",
                            }}
                        >
                            {anns.map((ann) => {
                                const sev = cardColors(ann);
                                return (
                                    <div
                                        key={ann.id}
                                        className="annotation-card"
                                        style={{
                                            background: sev.bg,
                                            borderLeft: `3px solid ${sev.border}`,
                                            opacity: ann.resolved ? 0.5 : 1,
                                            marginBottom: CARD_GAP,
                                        }}
                                    >
                                        <div className="annotation-card-header">
                                            <span>
                                                <span
                                                    style={{
                                                        display: "inline-block",
                                                        width: 8,
                                                        height: 8,
                                                        borderRadius: "50%",
                                                        background: sev.dot,
                                                        marginRight: 6,
                                                    }}
                                                />
                                                <strong>
                                                    {ann.annotation_type.replace(
                                                        /_/g,
                                                        " "
                                                    )}
                                                </strong>
                                            </span>
                                            <span className="annotation-card-meta">
                                                {ann.source === "agent"
                                                    ? "AI"
                                                    : "Human"}
                                            </span>
                                        </div>
                                        <EditableMessage
                                            annotation={ann}
                                            docId={docId!}
                                        />
                                        <div className="annotation-card-actions">
                                            <label className="annotation-resolve">
                                                <input
                                                    type="checkbox"
                                                    checked={ann.resolved}
                                                    onChange={() =>
                                                        docId &&
                                                        updateAnnotation(
                                                            docId,
                                                            ann.id,
                                                            {
                                                                resolved:
                                                                    !ann.resolved,
                                                            }
                                                        )
                                                    }
                                                />
                                                Resolved
                                            </label>
                                            <button
                                                className="btn btn-sm btn-danger"
                                                onClick={() =>
                                                    docId &&
                                                    deleteAnnotation(
                                                        docId,
                                                        ann.id
                                                    )
                                                }
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}

                            {/* Inline "+ Add annotation" for the active block */}
                            {isActive && addingForBlock !== blockId && (
                                <button
                                    className="btn btn-sm btn-add-annotation"
                                    onClick={() => setAddingForBlock(blockId)}
                                >
                                    + Add annotation
                                </button>
                            )}

                            {/* Inline creation form */}
                            {addingForBlock === blockId && (
                                <div className="annotation-form">
                                    <label>
                                        Type
                                        <select
                                            value={formType}
                                            onChange={(e) =>
                                                setFormType(e.target.value)
                                            }
                                        >
                                            {ANN_TYPES.map((t) => (
                                                <option
                                                    key={t.value}
                                                    value={t.value}
                                                >
                                                    {t.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label>
                                        Severity
                                        <select
                                            value={formSev}
                                            onChange={(e) =>
                                                setFormSev(
                                                    e.target.value as
                                                        | "info"
                                                        | "warning"
                                                        | "error"
                                                )
                                            }
                                        >
                                            <option value="info">Info</option>
                                            <option value="warning">
                                                Warning
                                            </option>
                                            <option value="error">Error</option>
                                        </select>
                                    </label>
                                    <label>
                                        Message
                                        <textarea
                                            value={formMsg}
                                            onChange={(e) =>
                                                setFormMsg(e.target.value)
                                            }
                                            rows={3}
                                            placeholder="Describe the issue... (supports $\LaTeX$)"
                                        />
                                    </label>
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <button
                                            className="btn btn-primary"
                                            onClick={handleCreate}
                                            disabled={
                                                saving || !formMsg.trim()
                                            }
                                        >
                                            {saving ? "Saving..." : "Save"}
                                        </button>
                                        <button
                                            className="btn btn-sm"
                                            onClick={() => {
                                                setAddingForBlock(null);
                                                setFormMsg("");
                                            }}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Empty state */}
                {slotBlockIds.size === 0 && (
                    <p className="annotation-panel-hint" style={{ padding: 16 }}>
                        No annotations yet. Click a block to add one.
                    </p>
                )}
            </div>
        </div>
    );
}
