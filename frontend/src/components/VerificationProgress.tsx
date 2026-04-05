import type { Annotation, Block } from "../types/models";

interface Props {
    blocks: Block[];
    annotationsByBlock: Map<string, Annotation[]>;
}

export default function VerificationProgress({
    blocks,
    annotationsByBlock,
}: Props) {
    // Only count content blocks (not section headings)
    const countable = blocks.filter((b) => b.block_type !== "section_heading");
    const total = countable.length;
    if (total === 0) return null;

    let checked = 0;
    let withIssues = 0;

    for (const b of countable) {
        const anns = annotationsByBlock.get(b.block_id) ?? [];
        const hasCheck = anns.some(
            (a) => a.annotation_type === "checked" && !a.resolved
        );
        const hasIssue = anns.some(
            (a) =>
                a.annotation_type !== "checked" &&
                !a.resolved &&
                (a.severity === "warning" || a.severity === "error")
        );

        if (hasIssue) withIssues++;
        else if (hasCheck) checked++;
    }

    const remaining = total - checked - withIssues;
    const pctChecked = (checked / total) * 100;
    const pctIssues = (withIssues / total) * 100;

    return (
        <div>
            <div className="verification-bar">
                {pctChecked > 0 && (
                    <div
                        className="verification-bar-segment verification-bar-checked"
                        style={{ flexBasis: `${pctChecked}%` }}
                    />
                )}
                {pctIssues > 0 && (
                    <div
                        className="verification-bar-segment verification-bar-errors"
                        style={{ flexBasis: `${pctIssues}%` }}
                    />
                )}
            </div>
            <p className="verification-summary">
                {checked}/{total} checked
                {withIssues > 0 && <>, {withIssues} with issues</>}
                {remaining > 0 && <>, {remaining} remaining</>}
            </p>
        </div>
    );
}
