import { useState } from "react";
import type { Annotation } from "../types/models";
import { useAnnotationStore } from "../stores/annotationStore";
import { useUIStore } from "../stores/uiStore";

interface CheckToggleProps {
    blockId: string;
    docId: string;
    annotations: Annotation[];
}

export default function CheckToggle({
    blockId,
    docId,
    annotations,
}: CheckToggleProps) {
    const { createAnnotation, deleteAnnotation } = useAnnotationStore();
    const { setActiveBlock } = useUIStore();
    const [busy, setBusy] = useState(false);

    const checkAnnotation = annotations.find(
        (a) => a.annotation_type === "checked" && !a.resolved
    );
    const isChecked = !!checkAnnotation;

    const toggle = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setActiveBlock(blockId); // select the block
        if (busy) return;
        setBusy(true);
        try {
            if (isChecked) {
                await deleteAnnotation(docId, checkAnnotation!.id);
            } else {
                await createAnnotation(docId, {
                    block_id: blockId,
                    annotation_type: "checked",
                    severity: "info",
                    message: "Checked",
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
