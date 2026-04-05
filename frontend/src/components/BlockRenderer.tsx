import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeMathjax from "rehype-mathjax";
import type { Annotation, Block } from "../types/models";
import { useUIStore } from "../stores/uiStore";

interface BlockRendererProps {
    block: Block;
    isContainer?: boolean;
    annotations?: Annotation[];
    orderedBlockIds?: string[];
}

const TYPE_STYLES: Record<string, React.CSSProperties> = {
    section_heading: {
        fontSize: "1.3em",
        fontWeight: "bold",
        marginTop: "24px",
        marginBottom: "12px",
        borderBottom: "1px solid #e0e0e0",
        paddingBottom: "4px",
    },
    theorem: {
        background: "#f8f9ff",
        borderLeft: "3px solid #4a6fa5",
        padding: "12px 16px",
        margin: "12px 0",
        borderRadius: "4px",
    },
    lemma: {
        background: "#f8f9ff",
        borderLeft: "3px solid #4a6fa5",
        padding: "12px 16px",
        margin: "12px 0",
        borderRadius: "4px",
    },
    proposition: {
        background: "#f8f9ff",
        borderLeft: "3px solid #4a6fa5",
        padding: "12px 16px",
        margin: "12px 0",
        borderRadius: "4px",
    },
    definition: {
        background: "#f5faf5",
        borderLeft: "3px solid #5a8a5a",
        padding: "12px 16px",
        margin: "12px 0",
        borderRadius: "4px",
    },
    proof: {
        borderLeft: "2px solid #ccc",
        padding: "8px 16px",
        margin: "8px 0",
    },
    equation: {
        textAlign: "center" as const,
        margin: "16px 0",
        padding: "8px",
    },
    paragraph: {
        margin: "8px 0",
        lineHeight: "1.6",
    },
    list: {
        margin: "8px 0",
        lineHeight: "1.6",
    },
};

const TYPE_LABELS: Record<string, string> = {
    theorem: "Theorem",
    lemma: "Lemma",
    proposition: "Proposition",
    corollary: "Corollary",
    definition: "Definition",
    remark: "Remark",
    proof: "Proof",
};

const CONTAINER_TYPES = new Set([
    "theorem",
    "lemma",
    "proposition",
    "corollary",
    "definition",
    "remark",
    "proof",
]);

const SEVERITY_RANK: Record<string, number> = { question: 1, warning: 2, error: 3 };

const ISSUE_STYLES: Record<string, React.CSSProperties> = {
    question: { background: "#fff8e1" },
    warning: { background: "#fff3e0" },
    error: { background: "#fff0f0" },
};

const INFO_STYLE: React.CSSProperties = { borderLeft: "3px solid #5b9bd5" };

const CHECK_STYLES: Record<string, React.CSSProperties> = {
    human: { background: "#e6f4ea" },
    agent: { background: "#f0faf0" },
};

function computeBlockOverlay(annotations: Annotation[]): React.CSSProperties {
    const issues = annotations.filter(
        (a) => a.category === "issue" && !a.resolved
    );
    const checks = annotations.filter(
        (a) => a.category === "check" && !a.resolved
    );
    const infos = annotations.filter(
        (a) => a.category === "info" && !a.resolved
    );

    // Issues take priority
    if (issues.length > 0) {
        const worst = issues.reduce((max, a) =>
            (SEVERITY_RANK[a.severity] ?? 0) > (SEVERITY_RANK[max.severity] ?? 0)
                ? a
                : max
        );
        return ISSUE_STYLES[worst.severity] ?? {};
    }

    // Then info
    if (infos.length > 0) {
        return INFO_STYLE;
    }

    // Then checks (human = darker green, agent = lighter)
    if (checks.length > 0) {
        const hasHumanCheck = checks.some((a) => a.source === "human");
        return CHECK_STYLES[hasHumanCheck ? "human" : "agent"];
    }

    return {};
}

export default function BlockRenderer({
    block,
    isContainer,
    annotations = [],
    orderedBlockIds = [],
}: BlockRendererProps) {
    const { activeBlockIds, anchorBlockId, setActiveBlock, setBlockRange } = useUIStore();
    const isActive = activeBlockIds.includes(block.block_id);

    const overlayStyle = computeBlockOverlay(annotations);

    const baseStyle = TYPE_STYLES[block.block_type] ?? TYPE_STYLES.paragraph;
    const needsCheckSpace = block.block_type !== "section_heading";
    const style: React.CSSProperties = {
        ...baseStyle,
        ...overlayStyle,
        cursor: "pointer",
        position: "relative",
        zIndex: isActive ? 2 : 1,
        borderRadius: "4px",
        transition: "background 0.15s, box-shadow 0.15s",
        ...(needsCheckSpace ? { paddingRight: "28px" } : {}),
        ...(isActive
            ? { boxShadow: "0 0 0 2px #4a6fa5" }
            : {}),
    };

    const label = TYPE_LABELS[block.block_type];
    const showContent =
        !isContainer && !CONTAINER_TYPES.has(block.block_type);

    return (
        <div
            data-block-id={block.block_id}
            style={style}
            onClick={(e) => {
                e.stopPropagation();
                if (e.shiftKey && anchorBlockId) {
                    window.getSelection()?.removeAllRanges();
                    setBlockRange(anchorBlockId, block.block_id, orderedBlockIds);
                } else {
                    setActiveBlock(isActive ? null : block.block_id);
                }
            }}
        >
            {label && (
                <span
                    style={{
                        fontWeight: "bold",
                        fontStyle:
                            block.block_type === "proof" ? "italic" : "normal",
                    }}
                >
                    {label}.{" "}
                </span>
            )}
            {showContent && block.content_original && (
                <Markdown
                    remarkPlugins={[remarkMath]}
                    rehypePlugins={[rehypeMathjax]}
                    components={{
                        p: ({ children }) => <span>{children}</span>,
                    }}
                >
                    {block.content_original}
                </Markdown>
            )}
        </div>
    );
}
