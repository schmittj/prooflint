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

/* ── Tag catalog ── */
const TAG_CATALOG: Record<string, { slug: string; label: string }[]> = {
    check: [
        { slug: "manual_review", label: "Manual Review" },
        { slug: "experiment", label: "Experiment" },
        { slug: "example_check", label: "Example" },
        { slug: "formalization", label: "Formalization" },
        { slug: "agent_review", label: "Agent Review" },
        { slug: "cross_reference", label: "Cross-reference" },
    ],
    info: [
        { slug: "summary", label: "Summary" },
        { slug: "reference", label: "Reference" },
        { slug: "remark", label: "Remark" },
    ],
    issue: [
        { slug: "typo", label: "Typo" },
        { slug: "assumption_mismatch", label: "Assumption Mismatch" },
        { slug: "incomplete_argument", label: "Incomplete Argument" },
        { slug: "gap", label: "Gap" },
        { slug: "handwaving", label: "Handwaving" },
        { slug: "notation_conflict", label: "Notation Conflict" },
        { slug: "calculation_error", label: "Calculation Error" },
        { slug: "false_citation", label: "False Citation" },
    ],
};

/* ── Display helpers ── */
const TAG_LABELS: Record<string, string> = {};
for (const tags of Object.values(TAG_CATALOG)) {
    for (const t of tags) TAG_LABELS[t.slug] = t.label;
}

function tagLabel(slug: string): string {
    return TAG_LABELS[slug] ?? slug.replace(/_/g, " ");
}

/* ── Card colors by category + severity ── */
const CATEGORY_COLORS = {
    check: { bg: "#e6f4ea", border: "#6abf69", dot: "#2e7d32" },
    info: { bg: "#eef4ff", border: "#b0c9f0", dot: "#5b9bd5" },
    issue: {
        question: { bg: "#fff8e6", border: "#e6c84a", dot: "#d4a017" },
        warning: { bg: "#fff3e0", border: "#e6994a", dot: "#e67700" },
        error: { bg: "#fff0f0", border: "#e68a8a", dot: "#d44" },
    },
} as const;

function cardColors(ann: Annotation) {
    if (ann.category === "check") return CATEGORY_COLORS.check;
    if (ann.category === "info") return CATEGORY_COLORS.info;
    const sev = ann.severity as "question" | "warning" | "error";
    return CATEGORY_COLORS.issue[sev] ?? CATEGORY_COLORS.issue.question;
}

/* ── Lifecycle action label per category ── */
function resolveLabel(category: string): string {
    if (category === "check") return "Revoke";
    if (category === "info") return "Archive";
    return "Resolve";
}

/* ── Layout: position annotation groups near their block Y ── */
interface LayoutGroup {
    blockId: string;
    targetY: number;
    height: number;
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
        const active = sorted[activeIdx];
        result.set(active.blockId, active.targetY);

        let ceiling = active.targetY;
        for (let i = activeIdx - 1; i >= 0; i--) {
            const g = sorted[i];
            const y = Math.max(0, Math.min(g.targetY, ceiling - g.height - CARD_GAP));
            result.set(g.blockId, y);
            ceiling = y;
        }

        let floor = active.targetY + active.height + CARD_GAP;
        for (let i = activeIdx + 1; i < sorted.length; i++) {
            const g = sorted[i];
            const y = Math.max(g.targetY, floor);
            result.set(g.blockId, y);
            floor = y + g.height + CARD_GAP;
        }
    } else {
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

/* ── Inline Markdown renderer ── */
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

/* ── Editable message ── */
function EditableMessage({
    annotation,
    docId,
}: {
    annotation: Annotation;
    docId: string;
}) {
    const { updateAnnotation } = useAnnotationStore();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(annotation.body);

    const save = async () => {
        const trimmed = draft.trim();
        if (trimmed !== annotation.body) {
            await updateAnnotation(docId, annotation.id, { body: trimmed });
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
                        setDraft(annotation.body);
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
                setDraft(annotation.body);
                setEditing(true);
            }}
            title="Click to edit"
        >
            {annotation.body ? (
                <AnnotationMessage text={annotation.body} />
            ) : (
                <span style={{ color: "#aaa", fontStyle: "italic" }}>Add comment...</span>
            )}
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

    const [blockYMap, setBlockYMap] = useState<Map<string, number>>(new Map());
    const [contentHeight, setContentHeight] = useState(1000);

    const [hideChecked, setHideChecked] = useState(false);

    // Form state
    const [addingForBlock, setAddingForBlock] = useState<string | null>(null);
    const [formCategory, setFormCategory] = useState<"check" | "info" | "issue">("issue");
    const [formTags, setFormTags] = useState<string[]>([]);
    const [formSev, setFormSev] = useState<"question" | "warning" | "error">("warning");
    const [formBody, setFormBody] = useState("");
    const [saving, setSaving] = useState(false);

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

    useEffect(() => {
        const reader = readerRef.current;
        const panel = panelRef.current;
        if (!reader || !panel) return;

        const sync = () => {
            panel.scrollTop = reader.scrollTop;
            measureBlocks();
        };

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

    useEffect(() => {
        setAddingForBlock(null);
    }, [activeBlockId]);

    // Reset tags when category changes
    useEffect(() => {
        setFormTags([]);
    }, [formCategory]);

    // Group annotations by start_block, applying hideChecked filter
    const grouped = useMemo(() => {
        const map = new Map<string, Annotation[]>();
        for (const a of annotations) {
            if (
                hideChecked &&
                a.category === "check" &&
                a.start_block !== activeBlockId
            ) {
                continue;
            }
            const arr = map.get(a.start_block) ?? [];
            arr.push(a);
            map.set(a.start_block, arr);
        }
        return map;
    }, [annotations, hideChecked, activeBlockId]);

    const slotBlockIds = useMemo(() => {
        const ids = new Set(grouped.keys());
        if (activeBlockId) ids.add(activeBlockId);
        return ids;
    }, [grouped, activeBlockId]);

    const layoutGroups = useMemo(
        () =>
            Array.from(slotBlockIds).map((blockId) => {
                const anns = grouped.get(blockId) ?? [];
                let items = anns.length;
                if (blockId === activeBlockId) {
                    items += addingForBlock === blockId ? 4 : 1;
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

    const panelHeight = useMemo(() => {
        let max = contentHeight;
        for (const [blockId, y] of positions) {
            const g = layoutGroups.find((g) => g.blockId === blockId);
            if (g) max = Math.max(max, y + g.height + 40);
        }
        return max;
    }, [positions, layoutGroups, contentHeight]);

    const toggleTag = (slug: string) => {
        setFormTags((prev) =>
            prev.includes(slug) ? prev.filter((t) => t !== slug) : [...prev, slug]
        );
    };

    const handleCreate = async () => {
        if (!docId || !addingForBlock) return;
        setSaving(true);
        try {
            await createAnnotation(docId, {
                start_block: addingForBlock,
                category: formCategory,
                tags: formTags,
                ...(formCategory === "issue" ? { severity: formSev } : {}),
                body: formBody.trim(),
            });
            setFormBody("");
            setFormTags([]);
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
                    Hide checks
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
                                const colors = cardColors(ann);
                                return (
                                    <div
                                        key={ann.id}
                                        className="annotation-card"
                                        style={{
                                            background: colors.bg,
                                            borderLeft: `3px solid ${colors.border}`,
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
                                                        background: colors.dot,
                                                        marginRight: 6,
                                                    }}
                                                />
                                                <strong style={{ textTransform: "capitalize" }}>
                                                    {ann.category}
                                                </strong>
                                                {ann.severity && (
                                                    <span className="annotation-severity-badge" style={{ marginLeft: 6 }}>
                                                        {ann.severity}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="annotation-card-meta">
                                                {ann.source === "agent"
                                                    ? "AI"
                                                    : "Human"}
                                            </span>
                                        </div>
                                        {/* Tag chips */}
                                        {ann.tags.length > 0 && (
                                            <div className="annotation-tag-chips">
                                                {ann.tags.map((t) => (
                                                    <span key={t} className="annotation-tag-chip">
                                                        {tagLabel(t)}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
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
                                                {resolveLabel(ann.category)}
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
                                        Category
                                        <select
                                            value={formCategory}
                                            onChange={(e) =>
                                                setFormCategory(
                                                    e.target.value as "check" | "info" | "issue"
                                                )
                                            }
                                        >
                                            <option value="issue">Issue</option>
                                            <option value="check">Check</option>
                                            <option value="info">Info</option>
                                        </select>
                                    </label>

                                    {/* Tags as checkboxes */}
                                    <fieldset className="annotation-form-tags">
                                        <legend>Tags</legend>
                                        {(TAG_CATALOG[formCategory] ?? []).map((t) => (
                                            <label key={t.slug} className="annotation-tag-option">
                                                <input
                                                    type="checkbox"
                                                    checked={formTags.includes(t.slug)}
                                                    onChange={() => toggleTag(t.slug)}
                                                />
                                                {t.label}
                                            </label>
                                        ))}
                                    </fieldset>

                                    {/* Severity — only for issues */}
                                    {formCategory === "issue" && (
                                        <label>
                                            Severity
                                            <select
                                                value={formSev}
                                                onChange={(e) =>
                                                    setFormSev(
                                                        e.target.value as
                                                            | "question"
                                                            | "warning"
                                                            | "error"
                                                    )
                                                }
                                            >
                                                <option value="question">
                                                    Question
                                                </option>
                                                <option value="warning">
                                                    Warning
                                                </option>
                                                <option value="error">Error</option>
                                            </select>
                                        </label>
                                    )}

                                    <label>
                                        Comment
                                        <textarea
                                            value={formBody}
                                            onChange={(e) =>
                                                setFormBody(e.target.value)
                                            }
                                            rows={3}
                                            placeholder="Describe... (supports $\LaTeX$)"
                                        />
                                    </label>
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <button
                                            className="btn btn-primary"
                                            onClick={handleCreate}
                                            disabled={saving}
                                        >
                                            {saving ? "Saving..." : "Save"}
                                        </button>
                                        <button
                                            className="btn btn-sm"
                                            onClick={() => {
                                                setAddingForBlock(null);
                                                setFormBody("");
                                                setFormTags([]);
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
