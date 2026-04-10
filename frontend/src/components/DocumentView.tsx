import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useDocumentStore } from "../stores/documentStore";
import { useAnnotationStore } from "../stores/annotationStore";
import { useAgentStore } from "../stores/agentStore";
import { useUIStore } from "../stores/uiStore";
import BlockRenderer, { computeBlockOverlay } from "./BlockRenderer";
import CheckToggle from "./CheckToggle";
import VerificationProgress from "./VerificationProgress";
import AnnotationPanel from "./AnnotationPanel";
import BotWizard from "./BotWizard";
import BotStatusBar from "./BotStatusBar";
import BotSummary from "./BotSummary";
import type { Annotation, Block } from "../types/models";
import "./DocumentView.css";

/** Truncated content preview for sidebar items */
function blockPreview(b: Block): string {
    const raw = (b.content_original || "").replace(/\n+/g, " ").trim();
    if (!raw) return b.block_type;
    const max = 50;
    return raw.length > max ? raw.slice(0, max) + "\u2026" : raw;
}

/** Single blue outline around a multi-block selection */
function SelectionOverlay({ readerRef, activeBlockIds }: {
    readerRef: React.RefObject<HTMLElement | null>;
    activeBlockIds: string[];
}) {
    const { layoutVersion } = useUIStore();
    const [style, setStyle] = useState<React.CSSProperties | null>(null);
    const [resizeTick, setResizeTick] = useState(0);

    // Recompute when the reader container resizes (window resize, sidebar toggle, etc.)
    useEffect(() => {
        const reader = readerRef.current;
        if (!reader) return;
        const ro = new ResizeObserver(() => setResizeTick((n) => n + 1));
        ro.observe(reader);
        return () => ro.disconnect();
    }, [readerRef]);

    useLayoutEffect(() => {
        const reader = readerRef.current;
        if (!reader || activeBlockIds.length < 2) { setStyle(null); return; }

        const rr = reader.getBoundingClientRect();
        let l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
        for (const id of activeBlockIds) {
            const el = reader.querySelector(`[data-block-id="${id}"]`);
            if (!el) continue;
            const er = el.getBoundingClientRect();
            l = Math.min(l, er.left); r = Math.max(r, er.right);
            t = Math.min(t, er.top);  b = Math.max(b, er.bottom);
        }
        if (t === Infinity) { setStyle(null); return; }

        const pad = 4;
        setStyle({
            position: "absolute",
            left: l - rr.left + reader.scrollLeft - pad,
            top:  t - rr.top  + reader.scrollTop  - pad,
            width:  r - l + pad * 2,
            height: b - t + pad * 2,
            boxShadow: "0 0 0 2px #4a6fa5",
            borderRadius: "6px",
            pointerEvents: "none",
            zIndex: 5,
            background: "transparent",
        });
    }, [activeBlockIds, readerRef, layoutVersion, resizeTick]);

    if (!style) return null;
    return <div style={style} />;
}

/** Group blocks under section headings for the sidebar */
interface SidebarSection {
    heading: Block | null;
    children: Block[];
}

function buildSections(topLevelBlocks: Block[]): SidebarSection[] {
    const sections: SidebarSection[] = [];
    let current: SidebarSection = { heading: null, children: [] };

    for (const b of topLevelBlocks) {
        if (b.block_type === "section_heading") {
            if (current.heading || current.children.length > 0) {
                sections.push(current);
            }
            current = { heading: b, children: [] };
        } else {
            current.children.push(b);
        }
    }
    if (current.heading || current.children.length > 0) {
        sections.push(current);
    }
    return sections;
}

/** Count annotations per block_id, bucketed by max severity */
function sectionAnnotationCounts(
    blocks: Block[],
    annotationsByBlock: Map<string, Annotation[]>
) {
    let info = 0,
        warning = 0,
        error = 0;
    for (const b of blocks) {
        const anns = annotationsByBlock.get(b.block_id) ?? [];
        for (const a of anns) {
            if (a.resolved || a.category === "check") continue;
            if (a.severity === "error") error++;
            else if (a.severity === "warning") warning++;
            else info++;
        }
    }
    return { info, warning, error };
}

export default function DocumentView() {
    const { id } = useParams<{ id: string }>();
    const { currentDocument, blocks, loading, fetchDocument, fetchBlocks } =
        useDocumentStore();
    const { annotations, fetchAnnotations } = useAnnotationStore();
    const { activeBlockIds, sidebarCollapsed, toggleSidebar, setActiveBlock } = useUIStore();
    const { fetchRuns, activeRun } = useAgentStore();
    const [showWizard, setShowWizard] = useState(false);

    useEffect(() => {
        if (id) {
            fetchDocument(id);
            fetchBlocks(id);
            fetchAnnotations(id);
            fetchRuns(id);
        }
    }, [id, fetchDocument, fetchBlocks, fetchAnnotations, fetchRuns]);

    // Derived data
    const topLevelBlocks = useMemo(
        () => blocks.filter((b) => !b.parent),
        [blocks]
    );

    const childrenOf = useMemo(() => {
        const map = new Map<string, Block[]>();
        for (const b of blocks) {
            if (b.parent) {
                const arr = map.get(b.parent) ?? [];
                arr.push(b);
                map.set(b.parent, arr);
            }
        }
        return (parentId: string) => map.get(parentId) ?? [];
    }, [blocks]);

    // Flat ordered list of all block IDs (for shift+click range selection)
    const orderedBlockIds = useMemo(() => {
        const ids: string[] = [];
        for (const b of topLevelBlocks) {
            ids.push(b.block_id);
            for (const c of childrenOf(b.id)) ids.push(c.block_id);
        }
        return ids;
    }, [topLevelBlocks, childrenOf]);

    // Index each annotation under its start_block (used for sidebar counts
    // and annotation panel positioning).
    const annotationsByBlock = useMemo(() => {
        const map = new Map<string, Annotation[]>();
        for (const a of annotations) {
            const arr = map.get(a.start_block) ?? [];
            arr.push(a);
            map.set(a.start_block, arr);
        }
        return map;
    }, [annotations]);

    // For rendering overlays: index each annotation under EVERY block it
    // covers (start_block through end_block).
    const effectiveAnnotations = useMemo(() => {
        const map = new Map<string, Annotation[]>();
        const add = (blockId: string, a: Annotation) => {
            const arr = map.get(blockId) ?? [];
            arr.push(a);
            map.set(blockId, arr);
        };
        for (const a of annotations) {
            add(a.start_block, a);
            if (a.end_block && a.end_block !== a.start_block) {
                const si = orderedBlockIds.indexOf(a.start_block);
                const ei = orderedBlockIds.indexOf(a.end_block);
                if (si >= 0 && ei >= 0) {
                    const lo = Math.min(si, ei);
                    const hi = Math.max(si, ei);
                    for (let i = lo + 1; i <= hi; i++) add(orderedBlockIds[i], a);
                }
            }
        }
        return map;
    }, [annotations, orderedBlockIds]);

    // Compute color-run positions so adjacent same-color blocks merge visually
    const colorRunInfo = useMemo(() => {
        const flat = orderedBlockIds;
        const bgColors = flat.map((bid) => {
            const anns = effectiveAnnotations.get(bid) ?? [];
            const overlay = computeBlockOverlay(anns);
            return overlay.background as string | undefined;
        });
        const info = new Map<string, "first" | "middle" | "last" | "solo">();
        for (let i = 0; i < flat.length; i++) {
            const bg = bgColors[i];
            if (!bg) continue;
            const prevSame = i > 0 && bgColors[i - 1] === bg;
            const nextSame = i < flat.length - 1 && bgColors[i + 1] === bg;
            if (prevSame && nextSame) info.set(flat[i], "middle");
            else if (prevSame) info.set(flat[i], "last");
            else if (nextSame) info.set(flat[i], "first");
            else info.set(flat[i], "solo");
        }
        return info;
    }, [orderedBlockIds, effectiveAnnotations]);

    const sections = useMemo(
        () => buildSections(topLevelBlocks),
        [topLevelBlocks]
    );

    const readerRef = useRef<HTMLElement>(null);

    if (loading || !currentDocument) {
        return <p>Loading document...</p>;
    }

    const scrollToBlock = (blockId: string, alsoSelect = false) => {
        if (alsoSelect) setActiveBlock(blockId);
        const el = document.querySelector(`[data-block-id="${blockId}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
    };

    return (
        <div className="doc-layout">
            {/* ── Left sidebar: structural summary ── */}
            <aside className={`doc-sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
                <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>
                    Structure
                </h3>
                <p style={{ color: "#888", fontSize: "0.8rem", margin: "0 0 12px" }}>
                    {blocks.length} blocks
                </p>

                {sections.map((section, i) => {
                    // Include top-level blocks AND their descendants
                    const topLevel = section.heading
                        ? [section.heading, ...section.children]
                        : section.children;
                    const allBlocks = topLevel.flatMap((b) => [
                        b,
                        ...childrenOf(b.id),
                    ]);
                    const counts = sectionAnnotationCounts(
                        allBlocks,
                        annotationsByBlock
                    );
                    const headingLabel = section.heading
                        ? section.heading.content_original
                        : "Preamble";

                    return (
                        <div key={i} className="sidebar-section">
                            <div
                                className="sidebar-section-heading"
                                style={{ cursor: "pointer" }}
                                onClick={() =>
                                    section.heading &&
                                    scrollToBlock(section.heading.block_id)
                                }
                            >
                                <span>{headingLabel}</span>
                                <span>
                                    {counts.error > 0 && (
                                        <span className="badge badge-error">
                                            {counts.error}
                                        </span>
                                    )}
                                    {counts.warning > 0 && (
                                        <span className="badge badge-warning">
                                            {counts.warning}
                                        </span>
                                    )}
                                    {counts.info > 0 && (
                                        <span className="badge badge-info">
                                            {counts.info}
                                        </span>
                                    )}
                                </span>
                            </div>
                            {section.children.map((b) => (
                                <div
                                    key={b.block_id}
                                    className={`sidebar-item ${activeBlockIds.includes(b.block_id) ? "active" : ""}`}
                                    onClick={() => scrollToBlock(b.block_id, true)}
                                >
                                    <span className="sidebar-item-label">
                                        {b.label ? `${b.label}: ` : ""}
                                        {blockPreview(b)}
                                    </span>
                                    {(annotationsByBlock.get(b.block_id)?.filter(
                                        (a) => !a.resolved && a.category === "issue"
                                    ).length ?? 0) > 0 && (
                                        <span className="badge badge-warning">
                                            {annotationsByBlock
                                                .get(b.block_id)!
                                                .filter((a) => !a.resolved && a.category === "issue")
                                                .length}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    );
                })}
            </aside>

            {/* ── Center: document reader ── */}
            {/* Sidebar toggle – grid-overlaid so it stays vertically centred on screen */}
            <button className="sidebar-toggle" onClick={toggleSidebar}>
                {sidebarCollapsed ? "\u25b6" : "\u25c0"}
            </button>

            <section className="doc-reader" ref={readerRef} onClick={(e) => {
                // Deselect when clicking whitespace — but not on blocks (they stopPropagation)
                const el = e.target as HTMLElement;
                if (!el.closest("button, [data-block-id], .check-toggle")) {
                    setActiveBlock(null);
                }
            }}>
                <h2 style={{ marginTop: 0 }}>
                    {currentDocument.title || "Untitled document"}
                </h2>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "8px" }}>
                    <p style={{ color: "#888", fontSize: "0.9em", margin: 0 }}>
                        {currentDocument.source_format} &middot;{" "}
                        {currentDocument.preset} &middot; {blocks.length} blocks
                        {annotations.filter((a) => !a.resolved && a.category === "issue").length > 0 &&
                            ` \u00b7 ${annotations.filter((a) => !a.resolved && a.category === "issue").length} open flags`}
                    </p>
                    <button
                        className="btn btn-sm btn-primary"
                        onClick={() => setShowWizard(true)}
                        disabled={activeRun?.status === "running" || activeRun?.status === "pending"}
                    >
                        Run Bot
                    </button>
                </div>

                <BotStatusBar docId={id!} />

                {showWizard && (
                    <BotWizard docId={id!} onClose={() => setShowWizard(false)} />
                )}

                <VerificationProgress
                    blocks={blocks}
                    annotationsByBlock={effectiveAnnotations}
                />

                <BotSummary />

                {blocks.length === 0 ? (
                    <div
                        style={{
                            padding: "16px",
                            background: "#f9f9f9",
                            borderRadius: "8px",
                            fontFamily: "monospace",
                            whiteSpace: "pre-wrap",
                            fontSize: "0.9em",
                        }}
                    >
                        No blocks yet. Upload a document to see it parsed.
                    </div>
                ) : (
                    topLevelBlocks.map((block) => {
                        const children = childrenOf(block.id);
                        const hasChildren = children.length > 0;
                        const blockAnns =
                            effectiveAnnotations.get(block.block_id) ?? [];

                        // Multi-select: show a single range checkbox on the
                        // first selected block, hide checkboxes on the rest.
                        const isMulti = activeBlockIds.length > 1;
                        const firstSel = isMulti ? activeBlockIds[0] : null;
                        const lastSel = isMulti ? activeBlockIds[activeBlockIds.length - 1] : null;
                        const isFirstInRange = block.block_id === firstSel;

                        const renderCheck = (bid: string, anns: Annotation[]) => {
                            if (isMulti && bid === firstSel) {
                                return (
                                    <CheckToggle
                                        blockId={bid}
                                        endBlockId={lastSel!}
                                        docId={id!}
                                        annotations={anns}
                                    />
                                );
                            }
                            if (isMulti && activeBlockIds.includes(bid)) return null;
                            return (
                                <CheckToggle
                                    blockId={bid}
                                    docId={id!}
                                    annotations={anns}
                                />
                            );
                        };

                        return (
                            <div key={block.id} style={{ position: "relative" }}>
                                {(isFirstInRange || block.block_type !== "section_heading") &&
                                    renderCheck(block.block_id, blockAnns)}
                                <BlockRenderer
                                    block={block}
                                    isContainer={hasChildren}
                                    annotations={blockAnns}
                                    orderedBlockIds={orderedBlockIds}
                                    colorRunPos={colorRunInfo.get(block.block_id)}
                                    inMultiSelect={isMulti}
                                >
                                    {children.map((child) => {
                                        const childAnns =
                                            effectiveAnnotations.get(
                                                child.block_id
                                            ) ?? [];
                                        const childIsFirst = child.block_id === firstSel;
                                        return (
                                            <div
                                                key={child.id}
                                                style={{
                                                    position: "relative",
                                                    marginTop: hasChildren
                                                        ? "6px"
                                                        : "0",
                                                }}
                                            >
                                                {(childIsFirst || !isMulti || !activeBlockIds.includes(child.block_id)) &&
                                                    renderCheck(child.block_id, childAnns)}
                                                <BlockRenderer
                                                    block={child}
                                                    annotations={childAnns}
                                                    orderedBlockIds={orderedBlockIds}
                                                    colorRunPos={colorRunInfo.get(child.block_id)}
                                                    inMultiSelect={isMulti}
                                                />
                                            </div>
                                        );
                                    })}
                                </BlockRenderer>
                            </div>
                        );
                    })
                )}
                <SelectionOverlay readerRef={readerRef} activeBlockIds={activeBlockIds} />
            </section>

            {/* ── Right panel: annotations ── */}
            <aside className="doc-right-panel">
                <AnnotationPanel readerRef={readerRef} orderedBlockIds={orderedBlockIds} />
            </aside>
        </div>
    );
}
