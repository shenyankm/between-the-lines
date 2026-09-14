import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import s from "./AttachmentPreview.module.css";

export const workAttachments = {
  purpose: {
    title: "附件1：试制材料规格说明",
    src: "/assets/work/material-specification.png",
  },
  quote: {
    title: "附件2：供应商报价单",
    src: "/assets/work/supplier-quotation.png",
  },
};

export function AttachmentPreview({
  attachment,
  onClose,
}: {
  attachment: keyof typeof workAttachments;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const document = workAttachments[attachment];
  useEffect(() => {
    const element = dialog.current;
    const opener = window.document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement)
        queueMicrotask(() => opener.isConnected && opener.focus());
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={s.preview}
      aria-labelledby="attachment-title"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
      <header className={s.header}>
        <h2 id="attachment-title">{document.title}</h2>
        <button type="button" aria-label="关闭附件预览" onClick={onClose}>
          <X size={22} aria-hidden="true" />
        </button>
      </header>
      <div className={s.page}>
        <img
          src={document.src}
          alt={document.title}
          width={905}
          height={1280}
        />
      </div>
    </dialog>
  );
}
