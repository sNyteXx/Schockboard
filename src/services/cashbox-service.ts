import { getCashboxSummary, getDebtSummaries, recordCorrection, recordPayment, recordWithdrawal } from "@/db/queries";

export const CashboxService = {
  getCashboxSummary,
  getDebtSummaries,
  recordPayment,
  recordCorrection,
  recordWithdrawal,
};
