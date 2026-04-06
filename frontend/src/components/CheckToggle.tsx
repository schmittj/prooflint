import { useState } from "react";
import type { Annotation } from "../types/models";
import { useAnnotationStore } from "../stores/annotationStore";
import { useUIStore } from "../stores/uiStore";

interface CheckToggleProps {
    blockId: string;
    docId: string;
    annotations: Annotation[];
    /** When set, the toggle creates/deletes a range annotation spanning start→end */
    endBlockId?: string;
}

export default function CheckToggle({
    blockId,
    docId,
    annotations,
    endBlockId,
}: CheckToggleProps) {
    const { createAnnotation, deleteAnnotation } = useAnnotationStore();
    const { setActiveBlock } = useUIStore();
    const [busy, setBusy] = useState(false);

    const isRange = !!endBlockId && endBlockId !== blockId;

    const checkAnnotation = annotations.find((a) => {
        if (a.category !== "check" || a.resolved) return false;
        // Range mode: match only the exact span
        if (isRange) return a.start_block === blockId && a.end_block === endBlockId;
        // Single-block mode: any covering check counts (including range annotations)
        return true;
    });
    const isChecked = !!checkAnnotation;

    const toggle = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setActiveBlock(blockId);
        if (busy) return;
        setBusy(true);
        try {
            if (isChecked) {
                await deleteAnnotation(docId, checkAnnotation!.id);
            } else {
                await createAnnotation(docId, {
                    start_block: blockId,
                    ...(isRange ? { end_block: endBlockId } : {}),
                    category: "check",
                    tags: ["manual_review"],
                    body: "Checked",
                });
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className={`check-toggle ${isChecked ? "checked" : ""}`}
            title={isChecked ? "Unmark verification" : "Mark as verified"}
        >
            <input
                type="checkbox"
                checked={isChecked}
                disabled={busy}
                onClick={toggle}
                readOnly
            />
        </div>
    );
}
