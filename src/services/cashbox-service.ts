import { getCashboxSummary, getDebtSummaries, recordCorrection, recordPayment } from "@/db/queries";

export const CashboxService = {
  getCashboxSummary,
  getDebtSummaries,
  recordPayment,
  recordCorrection,
};
