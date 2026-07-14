import { globSync } from "glob";
import { readFileSync } from "node:fs";

// Temporary, explicitly documented exceptions. New entries require a rationale
// in docs/FRONTEND_TRANSPORT_BOUNDARY.md and should be removed when migrated.
const ALLOWED_COMPONENT_TRANSPORT = new Set([
  "src/components/admin/AdminAuditPanel.tsx",
  "src/components/admin/AdminView.tsx",
  "src/components/admin/FeatureFlagsPanel.tsx",
  "src/components/admin/LegalVersionHistoryPanel.tsx",
  "src/components/admin/RelationTypesPanel.tsx",
  "src/components/auth/ChangePasswordDialog.tsx",
  "src/components/auth/DeleteAccountDialog.tsx",
  "src/components/auth/TwoFactorDialog.tsx",
  "src/components/settings/DeleteAccountPanel.tsx",
  "src/components/settings/TwoFactorPanel.tsx",
  "src/components/settings/UserSettingsView.tsx",
  "src/components/shared/member-sheet/LinkExistingTreeDialog.tsx",
  "src/components/view/database-management-view/dialog/LinkedTreesGraphDialog.tsx",
  "src/components/view/database-management-view/dialog/MergeTreesDialog.tsx",
  "src/components/view/database-management-view/dialog/ShareTreeDialog.tsx",
  "src/components/view/tree-view/CanvasSearch.tsx",
]);

const files = globSync("src/components/**/*.{ts,tsx}", { ignore: "**/*.test.*" });
const violations = files.filter((file) => {
  const source = readFileSync(file, "utf8");
  const importsTransport = /from ["']@\/services\/(?:api|[A-Za-z]+Service)["']/.test(source);
  const isTypeOrErrorOnly = !/\b(?:api\.|[A-Za-z]+Service\.)/.test(source);
  return importsTransport && !isTypeOrErrorOnly && !ALLOWED_COMPONENT_TRANSPORT.has(file);
});

if (violations.length > 0) {
  console.error("Component transport-boundary violations:");
  violations.forEach((file) => console.error(`  - ${file}`));
  process.exit(1);
}

console.log("Transport boundary check passed.");
