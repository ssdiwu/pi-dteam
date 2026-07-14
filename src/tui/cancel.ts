import { t, type Translate } from "./i18n.js";

export interface CancelUI {
  confirm(title: string, message: string): Promise<boolean>;
}

export interface CancelManager {
  cancel(workerId: string, reason: string): void;
}

/** 用户取消唯一入口：确认前不触碰 worker，确认后固定使用 user_cancelled。 */
export async function confirmWorkerCancellation(ui: CancelUI, manager: CancelManager, workerId: string, title: string, translate: Translate = t): Promise<boolean> {
  const confirmed = await ui.confirm(translate("cancel.title"), translate("cancel.message", { title }));
  if (!confirmed) return false;
  manager.cancel(workerId, "user_cancelled");
  return true;
}
