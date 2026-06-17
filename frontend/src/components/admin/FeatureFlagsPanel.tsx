import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  AdminService,
  FeatureFlag,
  FeatureState,
} from "@/services/AdminService";
import { useAuthStore } from "@/hooks/useAuthStore";
import { User } from "@/types/user";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Props = {
  users: User[];
};

const STATES: FeatureState[] = ["on", "off", "beta"];

export const FeatureFlagsPanel = ({ users }: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.features" });
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        setFlags(await AdminService.listFeatures());
      } catch (err) {
        console.error(err);
        toast.error(t("error"));
      }
    })();
  }, [t]);

  const applyUpdate = async (
    flag: FeatureFlag,
    changes: { state?: FeatureState; allowlist?: string[] },
    notifySuccess: boolean,
  ) => {
    try {
      const updated = await AdminService.updateFeature(flag.name, changes);
      setFlags((prev) =>
        prev.map((f) => (f.name === updated.name ? updated : f)),
      );
      // The admin's own gated UI should follow the change immediately.
      await refreshMe();
      if (notifySuccess) toast.success(t("saved"));
    } catch (err) {
      console.error(err);
      toast.error(t("error"));
    }
  };

  const userOptions = users.map((u) => ({ label: u.username, value: u.id }));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
      <div className="space-y-2">
        {flags.map((flag) => (
          <div key={flag.name} className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-sm">{t(`names.${flag.name}`)}</p>
                <p className="text-xs text-muted-foreground">
                  {t(`descriptions.${flag.name}`)}
                </p>
              </div>
              <Select
                value={flag.state}
                onValueChange={(state) =>
                  applyUpdate(flag, { state: state as FeatureState }, true)
                }
              >
                <SelectTrigger className="w-28 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATES.map((state) => (
                    <SelectItem key={state} value={state}>
                      {t(`state-${state}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {flag.state === "beta" && (
              <MultiSelect
                options={userOptions}
                defaultValue={flag.allowlist}
                onValueChange={(allowlist) =>
                  applyUpdate(flag, { allowlist }, false)
                }
                placeholder={t("allowlist-placeholder")}
                hideSelectAll
                maxCount={5}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
