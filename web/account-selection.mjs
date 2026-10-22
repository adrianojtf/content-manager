export function resolveSelectedAccountId(accounts, selectedAccountId) {
  if (!Array.isArray(accounts) || accounts.length === 0) return null;
  if (selectedAccountId && accounts.some((account) => account.id === selectedAccountId)) return selectedAccountId;
  return accounts.length === 1 ? accounts[0].id : null;
}
