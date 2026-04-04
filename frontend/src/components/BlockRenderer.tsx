import { MathJax } from "better-react-mathjax";
import type { Block } from "../types/models";
import { useUIStore } from "../stores/uiStore";

interface BlockRendererProps {
    block: Block;
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

export default function BlockRenderer({ block }: BlockRendererProps) {
    const { activeBlockId, setActiveBlock } = useUIStore();
    const isActive = activeBlockId === block.block_id;

    const baseStyle = TYPE_STYLES[block.block_type] ?? TYPE_STYLES.paragraph;
    const style: React.CSSProperties = {
        ...baseStyle,
        cursor: "pointer",
        borderRadius: "4px",
        transition: "background 0.15s",
        ...(isActive
            ? { outline: "2px solid #4a6fa5", outlineOffset: "2px" }
            : {}),
    };

    const label = TYPE_LABELS[block.block_type];

    return (
        <div
            data-block-id={block.block_id}
            style={style}
            onClick={() =>
                setActiveBlock(isActive ? null : block.block_id)
            }
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
            <MathJax inline dynamic>
                {block.content_original}
            </MathJax>
        </div>
    );
}
