import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { PlatformApi } from "../services/platformApi";

const DELETE_CONFIRMATION = "내 계정 삭제";

type AccountSafetyPanelProps = {
  api: PlatformApi;
  token: string;
  onAccountDeleted: () => Promise<void> | void;
};

function AccountSafetyPanel({ api, token, onAccountDeleted }: AccountSafetyPanelProps) {
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const confirmationDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!confirmingDelete) return undefined;
    const dialog = confirmationDialogRef.current;
    if (!dialog) return undefined;
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    if (deleting) dialog.focus();
    else confirmationRef.current?.focus();
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
    };
  }, [confirmingDelete, deleting]);

  const exportAccount = async () => {
    if (!api.exportAccount || exporting) return;
    setExporting(true);
    setStatus(null);
    setError(null);
    try {
      const resource = await api.exportAccount(token);
      downloadJson(resource, `modu-brain-account-${dateStamp(new Date())}.json`);
      setStatus("계정 데이터 JSON 파일을 만들었습니다.");
    } catch (exportError) {
      setError(messageFrom(exportError));
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    if (!api.deleteAccount || confirmation !== DELETE_CONFIRMATION || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteAccount(token, "delete my account");
      await onAccountDeleted();
    } catch (deleteError) {
      setError(messageFrom(deleteError));
      setDeleting(false);
    }
  };

  const closeConfirmation = () => {
    if (deleting) return;
    setConfirmingDelete(false);
    setConfirmation("");
    window.setTimeout(() => document.getElementById("account-delete-open")?.focus(), 0);
  };

  const handleConfirmationKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !deleting) {
      event.preventDefault();
      closeConfirmation();
    }
  };

  return (
    <section className="account-safety-card" aria-labelledby="account-safety-title">
      <div>
        <p className="section-kicker">Account safety</p>
        <h2 id="account-safety-title">내 데이터 관리</h2>
        <p>저장된 데이터를 JSON으로 내려받거나 계정과 연결된 모든 프로젝트를 영구 삭제할 수 있습니다.</p>
      </div>
      <div className="account-safety-actions">
        <button
          className="button secondary"
          type="button"
          disabled={!api.exportAccount || exporting}
          onClick={() => void exportAccount()}
        >
          {exporting ? "내보내는 중…" : "내 데이터 내려받기"}
        </button>
        <button
          id="account-delete-open"
          className="button danger"
          type="button"
          disabled={!api.deleteAccount}
          onClick={() => {
            setStatus(null);
            setError(null);
            setConfirmingDelete(true);
          }}
        >
          계정 영구 삭제
        </button>
      </div>

      {!api.exportAccount || !api.deleteAccount ? (
        <p className="account-safety-note">현재 배포에서는 일부 계정 관리 기능을 사용할 수 없습니다.</p>
      ) : null}
      {status && <p className="notice success" role="status">{status}</p>}
      {error && !confirmingDelete && <p className="notice error" role="alert">{error}</p>}

      {confirmingDelete && (
        <dialog
          ref={confirmationDialogRef}
          className="confirm-dialog"
          role="alertdialog"
          tabIndex={-1}
          aria-busy={deleting}
          aria-modal="true"
          aria-labelledby="account-delete-title"
          aria-describedby="account-delete-description"
          onCancel={(event) => {
            event.preventDefault();
            closeConfirmation();
          }}
          onKeyDown={handleConfirmationKeyDown}
        >
            <p className="section-kicker">Permanent action</p>
            <h3 id="account-delete-title">계정과 모든 저장 데이터를 삭제할까요?</h3>
            <p id="account-delete-description">
              프로젝트, 원문, 분석 스냅숏, 주석, 공유 링크가 모두 삭제되며 되돌릴 수 없습니다.
              계속하려면 아래에 <strong>{DELETE_CONFIRMATION}</strong>를 입력하세요.
            </p>
            <label className="field compact-field" htmlFor="account-delete-confirmation">
              <span>확인 문구</span>
              <input
                ref={confirmationRef}
                id="account-delete-confirmation"
                value={confirmation}
                autoComplete="off"
                disabled={deleting}
                onChange={(event) => setConfirmation(event.target.value)}
                onKeyDown={handleConfirmationKeyDown}
              />
            </label>
            {error && <p className="notice error" role="alert">{error}</p>}
            <div className="confirm-actions">
              <button className="button secondary" type="button" disabled={deleting} onClick={closeConfirmation} onKeyDown={handleConfirmationKeyDown}>
                취소
              </button>
              <button
                className="button danger"
                type="button"
                disabled={deleting || confirmation !== DELETE_CONFIRMATION}
                onClick={() => void deleteAccount()}
                onKeyDown={handleConfirmationKeyDown}
              >
                {deleting ? "삭제하는 중…" : "모든 데이터와 계정 삭제"}
              </button>
            </div>
        </dialog>
      )}
    </section>
  );
}

function downloadJson(value: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function dateStamp(date: Date) {
  return date.toISOString().slice(0, 10);
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}

export default AccountSafetyPanel;
